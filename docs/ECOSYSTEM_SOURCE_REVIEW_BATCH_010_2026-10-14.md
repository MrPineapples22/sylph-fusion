# Ecosystem source review — batch 010

This batch reviews 15 Metaplex, Raydium, Meteora, Orca, Jupiter, and third-party trading repositories. Source-by-source evidence is recorded in `research/registry/source-review-batch-010-2026-10-14.json`.

## Findings

- BlockBuster's useful lesson is that IDLs alone do not describe every account semantic; its Metaplex-specific parser knowledge is not directly applicable to Pump/Raydium swaps.
- Raydium and Meteora libraries cover different pool families and language/runtime boundaries. The existing Meteora DLMM research adapter does not establish DAMM/DBC executable quotes; those would require separate official fixtures and current fee math.
- Jupiter's old Node quote wrapper is a legacy API reference; SYLPH already uses a bounded V2 research path. Jupiter's RFQ toolkit is for makers/webhooks, not a general quote client.
- Meteora Invent, sol-trade-sdk, and copy/sniper bots can construct or submit transactions. Their examples were not run, installed, or copied; they do not get execution authority.
- Net execution accounting must distinguish quote, built transaction, submission, landing, settlement and fee-sharing flows.

## Verification

Official repository pages and README descriptions were reviewed. No package was installed and no signing or broadcast path was invoked. Findings remain partial pending pinned source, program fixtures, license review, and deterministic validation.
