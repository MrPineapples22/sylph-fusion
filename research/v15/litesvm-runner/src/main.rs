use base64::Engine;
use litesvm::LiteSVM;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_account::Account;
use solana_address::Address;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::{env, fs, str::FromStr};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Program { id: String, path: String, sha256: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SnapshotAccount { address: String, lamports: u64, owner: String, executable: bool, rent_epoch: u64, data_base64: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    slot: u64,
    program: Program,
    accounts: Vec<SnapshotAccount>,
    payer_keypair_path: String,
    instruction_data_base64: String,
    metas: Vec<Meta>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Meta { address: String, is_signer: bool, is_writable: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDelta { address: String, before_lamports: String, after_lamports: String, lamports_delta: String, before_data_sha256: Option<String>, after_data_sha256: Option<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Output { status: String, slot: u64, program_binary_sha256: String, compute_units_consumed: Option<u64>, fee_lamports: Option<u64>, error: Option<String>, account_deltas: Vec<AccountDelta> }

fn hash(bytes: &[u8]) -> String { hex::encode(Sha256::digest(bytes)) }
fn address(s: &str) -> Result<Address, String> { Address::from_str(s).map_err(|e| e.to_string()) }
fn decode(s: &str) -> Result<Vec<u8>, String> { base64::engine::general_purpose::STANDARD.decode(s).map_err(|e| e.to_string()) }
fn run() -> Result<Output, String> {
    let path = env::args().nth(1).ok_or("usage: cargo run -- input.json")?;
    let input: Input = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let binary = fs::read(&input.program.path).map_err(|e| e.to_string())?;
    let binary_hash = hash(&binary);
    if binary_hash != input.program.sha256.to_lowercase() { return Err("PROGRAM_HASH_MISMATCH".into()); }
    let program_id = address(&input.program.id)?;
    let payer_bytes: Vec<u8> = serde_json::from_slice(&fs::read(&input.payer_keypair_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let payer = Keypair::try_from(payer_bytes.as_slice()).map_err(|e| e.to_string())?;
    let mut svm = LiteSVM::new();
    svm.warp_to_slot(input.slot);
    svm.add_program(program_id, &binary).map_err(|e| format!("{e:?}"))?;
    let mut before = Vec::new();
    for a in &input.accounts {
        let key = address(&a.address)?;
        let account = Account { lamports: a.lamports, data: decode(&a.data_base64)?, owner: address(&a.owner)?, executable: a.executable, rent_epoch: a.rent_epoch };
        svm.set_account(key, account.clone()).map_err(|e| format!("{e:?}"))?;
        before.push((key, account));
    }
    if !before.iter().any(|(k,_)| *k == payer.pubkey()) { return Err("PAYER_SNAPSHOT_MISSING".into()); }
    let mut metas = Vec::new();
    for m in &input.metas {
        let key = address(&m.address)?;
        metas.push(if m.is_writable { AccountMeta::new(key, m.is_signer) } else { AccountMeta::new_readonly(key, m.is_signer) });
    }
    if input.metas.iter().any(|m| m.is_signer && address(&m.address).ok() != Some(payer.pubkey())) { return Err("UNSUPPORTED_ADDITIONAL_SIGNERS".into()); }
    let ix = Instruction { program_id, accounts: metas, data: decode(&input.instruction_data_base64)? };
    let tx = Transaction::new(&[&payer], Message::new(&[ix], Some(&payer.pubkey())), svm.latest_blockhash());
    let result = svm.send_transaction(tx);
    let (status, cu, fee, error) = match result {
        Ok(meta) => ("EXECUTED".to_string(), Some(meta.compute_units_consumed), Some(meta.fee), None),
        Err(failed) => ("EXECUTION_FAILED".to_string(), Some(failed.meta.compute_units_consumed), Some(failed.meta.fee), Some(format!("{:?}", failed.err))),
    };
    let deltas = before.into_iter().map(|(key, old)| {
        let new = svm.get_account(&key);
        let after = new.as_ref().map(|a| a.lamports).unwrap_or(0);
        AccountDelta {
            address: key.to_string(), before_lamports: old.lamports.to_string(), after_lamports: after.to_string(),
            lamports_delta: (i128::from(after) - i128::from(old.lamports)).to_string(),
            before_data_sha256: Some(hash(&old.data)), after_data_sha256: new.as_ref().map(|a| hash(&a.data)),
        }
    }).collect();
    Ok(Output { status, slot: input.slot, program_binary_sha256: binary_hash, compute_units_consumed: cu, fee_lamports: fee, error, account_deltas: deltas })
}
fn main() {
    match run() {
        Ok(out) => { println!("{}", serde_json::to_string_pretty(&out).unwrap()); if out.status != "EXECUTED" { std::process::exit(1); } },
        Err(e) => { eprintln!("V15 BLOCKED: {e}"); std::process::exit(2); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_system_interface::instruction::transfer;

    #[test]
    fn deterministic_litesvm_transfer_reconciles_fee_and_balances() {
        let payer = Keypair::new();
        let receiver = Keypair::new().pubkey();
        let mut svm = LiteSVM::new();
        let starting_balance = 1_000_000_000u64;
        let amount = 123_456u64;
        svm.airdrop(&payer.pubkey(), starting_balance).unwrap();
        let ix = transfer(&payer.pubkey(), &receiver, amount);
        let tx = Transaction::new(
            &[&payer],
            Message::new(&[ix], Some(&payer.pubkey())),
            svm.latest_blockhash(),
        );
        let result = svm.send_transaction(tx).expect("system transfer must succeed");
        let payer_after = svm.get_balance(&payer.pubkey()).unwrap();
        let receiver_after = svm.get_balance(&receiver).unwrap();
        assert_eq!(receiver_after, amount);
        assert_eq!(payer_after + amount + result.fee, starting_balance);
        assert!(result.compute_units_consumed > 0);
    }

    #[test]
    fn sha256_rejects_different_binary_bytes() {
        assert_ne!(hash(b"program-a"), hash(b"program-b"));
        assert_eq!(hash(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn invalid_base64_is_rejected() {
        assert!(decode("not base64!").is_err());
    }
}
