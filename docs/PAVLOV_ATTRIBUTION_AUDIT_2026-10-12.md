# Pavlov Attribution CSV Audit — 2026-10-12

## Scope and snapshot

This is a read-only audit of the user-supplied `D:\pump\SOL-SYLPH\pavlov_attributions.csv`. It does not import the file into runtime state, calibration, model training, or execution policy. The terminal no longer loads either the attached file or the repository CSV as a runtime fallback, and its CSV-reload button was removed. The audit used the file as it existed on 2026-10-12 at 15:05 local time (America/Phoenix); its SHA-256 was `AD6C3960B8C2052C1E6D9AD07BD532FA474B3108D0BE95C4BA4ADF8F23564414` (4,067,085 bytes). A later replacement of the source file would require a new audit.

The repository's `data/pavlov_attributions.csv` is a different snapshot (408,187 bytes; SHA-256 `2D2DF72BB56E929392234A20C48BCBF188A2957E9145E9E2B1E44BA79B624438`) and was not substituted for the attached file.

## Observed results

- 8,349 rows, 8,349 distinct trade IDs, and 846 distinct mint strings.
- Close timestamps span 2026-09-26 00:52:50 UTC through 2026-10-12 22:05:17 UTC.
- Summed cost basis is $113,189.18; summed proceeds are $111,151.13; reported realized P&L is -$2,038.05, or -1.80% of summed basis.
- Every row's reported P&L reconciles to proceeds minus cost basis within $0.000001. This is an internal arithmetic consistency check only.
- `protocol_fee_usd`, `priority_fee_usd`, and `total_fees_usd` are blank on all 8,349 rows. The reported return therefore cannot establish net returns after fees.
- `exit_envelope_hash` is present on every row, but each value is only `0x` plus eight hexadecimal characters (32-bit shape). All are distinct in this snapshot; distinctness and shape do not establish cryptographic provenance or bind the row to source evidence.
- `was_decision_sound` counts are 6,197 true, 324 false, and 1,828 `UNKNOWN`. These labels are not an independent verification of process quality.

## Audit conclusion

The snapshot reports negative weighted gross P&L and lacks fee data and independently verifiable row provenance. It is not evidence of profitable performance, net profitability, or a calibrated policy improvement. No rows or labels from it were applied to runtime decisions.
