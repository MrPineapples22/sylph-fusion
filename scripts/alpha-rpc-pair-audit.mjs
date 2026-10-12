import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=x=>createHash('sha256').update(x).digest('hex');
const fail=x=>{throw Error(x)};
function validate(tx,signature,wallet,mint){
 if(!tx||!tx.meta||!tx.transaction||!tx.transaction.message||tx.meta.err!==null)fail('MISSING_OR_FAILED_TRANSACTION');
 if(!Array.isArray(tx.meta.preBalances)||!Array.isArray(tx.meta.postBalances)||tx.meta.preBalances.length!==tx.meta.postBalances.length)fail('INVALID_SOL_BALANCES');
 if(!Array.isArray(tx.meta.preTokenBalances)||!Array.isArray(tx.meta.postTokenBalances))fail('TOKEN_BALANCES_UNAVAILABLE');
 if(!Number.isSafeInteger(tx.meta.fee)||tx.meta.fee<0)fail('INVALID_FEE');
 const keys=tx.transaction.message.accountKeys;
 if(!Array.isArray(keys))fail('ACCOUNT_KEYS_MISSING');
 const addresses=keys.map(x=>typeof x==='string'?x:x?.pubkey);
 const index=addresses.indexOf(wallet);if(index<0)fail('WALLET_NOT_IN_TRANSACTION');
 if(index>=tx.meta.preBalances.length)fail('ACCOUNT_INDEX_MISMATCH');
 const pre=tx.meta.preBalances[index],post=tx.meta.postBalances[index];
 if(!Number.isSafeInteger(pre)||!Number.isSafeInteger(post)||pre<0||post<0)fail('UNSAFE_LAMPORT_BALANCE');
 const balanceDelta=BigInt(post)-BigInt(pre);
 function tokenTotal(balances){
  let total=0n,found=false;
  for(const b of balances){
   if(b.mint!==mint||b.owner!==wallet)continue;
   const amount=b.uiTokenAmount?.amount;
   if(typeof amount!=='string'||!/^\\d+$/.test(amount))fail('INVALID_TOKEN_AMOUNT');
   total+=BigInt(amount);found=true;
  }
  return {total,found};
 }
 const before=tokenTotal(tx.meta.preTokenBalances),after=tokenTotal(tx.meta.postTokenBalances);
 if(!before.found&&!after.found)fail('WALLET_TOKEN_BALANCE_NOT_FOUND');
 const tokenDelta=after.total-before.total;
 if(tokenDelta===0n)fail('ZERO_TOKEN_DELTA');
 const fee=BigInt(tx.meta.fee);
 // Fee payer may differ from target wallet; never infer fee ownership from signature alone.
 const payer=addresses[0];
 if(payer!==wallet)fail('UNSUPPORTED_NON_PAYER_WALLET');
 const grossSolDelta=balanceDelta+fee;
 if((tokenDelta>0n&&grossSolDelta>=0n)||(tokenDelta<0n&&grossSolDelta<=0n))fail('NOT_SIMPLE_SOL_TOKEN_SWAP');
 if(typeof tx.blockTime!=='number'||!Number.isSafeInteger(tx.blockTime)||tx.blockTime<=0)fail('MISSING_BLOCK_TIME');
 return {signature,slot:tx.slot,time:new Date(tx.blockTime*1000).toISOString(),tokenDelta:tokenDelta.toString(),grossSolDeltaLamports:grossSolDelta.toString(),feeLamports:fee.toString(),rawHash:digest(JSON.stringify(tx))};
}
export function inspectPair({wallet,mint,entrySignature,exitSignature,entryTransaction,exitTransaction}){
 if(typeof wallet!=='string'||!wallet||typeof mint!=='string'||!mint||!entrySignature||!exitSignature||entrySignature===exitSignature)fail('INVALID_PAIR_IDENTITY');
 const entry=validate(entryTransaction,entrySignature,wallet,mint),exit=validate(exitTransaction,exitSignature,wallet,mint);
 if(BigInt(entry.tokenDelta)<=0n||BigInt(exit.tokenDelta)>=0n)fail('WRONG_TRADE_DIRECTION');
 if(BigInt(entry.grossSolDeltaLamports)>=0n||BigInt(exit.grossSolDeltaLamports)<=0n)fail('WRONG_SOL_DIRECTION');
 if(BigInt(entry.tokenDelta)+BigInt(exit.tokenDelta)!==0n)fail('NON_CLOSED_POSITION');
 if(Date.parse(exit.time)<Date.parse(entry.time))fail('EXIT_BEFORE_ENTRY');
 return {status:'RPC_METADATA_RECONCILED_NOT_EXECUTION_PARITY',wallet,mint,entry,exit,entryDebitLamports:(-BigInt(entry.grossSolDeltaLamports)).toString(),exitCreditLamports:exit.grossSolDeltaLamports,networkFeesLamports:(BigInt(entry.feeLamports)+BigInt(exit.feeLamports)).toString(),limitations:['Wallet SOL delta may include rent, tips, unrelated transfers or wrapped-SOL operations','Transaction metadata alone cannot attribute price impact, priority fee and Jito tip independently','Requires independent instruction decoding and token-account closure verification before tournament admission']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output){console.error('Usage: node scripts/alpha-rpc-pair-audit.mjs pair.json audit.json');process.exit(2);}
 try{const raw=readFileSync(input);const result=inspectPair(JSON.parse(raw.toString('utf8')));result.inputSha256=digest(raw);writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({output,status:result.status}));}
 catch(e){console.error('RPC_PAIR_BLOCKED:',e.message);process.exitCode=1;}
}
