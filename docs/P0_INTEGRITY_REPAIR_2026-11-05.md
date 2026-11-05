# P0 Evidence Integrity Repair (2026-11-05)

**State: Draft. Paper/research only. Live signing and trading are blocked.**

## Changes

1. Engine entry and restriction paths no longer submit invented identical legacy/shadow decisions to the divergence auditor. A typed NOT_EVALUATED gap is recorded instead. Zero divergences without evaluated independent decisions is not a parity certificate.
2. Legacy app PaperPortfolio refuses unreadable and schema-invalid existing account snapshots instead of silently resetting to a newly funded account. Only genuinely missing account files are treated as new accounts.
3. Capital barrier denies malformed/nonfinite inputs, hashes all of its decision-relevant inputs, and no longer receives fabricated positive bankroll/liquidity floors from the Engine's paper-policy integration.
4. The formerly misleading SQLite-named Fusion journal is now backed by actual SQLite transactions, with restart and stale-revision regression tests. This is not a replacement for the existing canonical Engine Store or paper-account ledger.
5. New P0 regression checks and a proposed GitHub Actions workflow.

## Outstanding integration and qualification blockers

- **Shadow comparison not yet wired.** The UnifiedPipelineUnit has no independent decision result on the Engine entry path; NOT_EVALUATED is accurate, not a repair of complete parity.
- **Legacy paper account still unqualified.** JSON/CSV writes are separate, valuations are optimistic, and the account is independent of the SQLite-backed PaperLedgerStore. Qualified paper requires a controlled migration and transactional integration.
- **FusionJournalStore's SQLite implementation is now genuinely file-backed** with WAL/FULL and transactional head, revisions, and rows. It is **not yet integrated** as the production account/ingress writer, nor independently crash/fault qualified; the separate in-memory test store remains available for test fixtures.
- Feed/CENSUS-R bank identities are synthesized from slots in the current feed path. Fork-aware transaction truth and effective reconciliation remain incomplete.
- Capital inputs include explicitly documented unvalidated risk assumptions; risk result is an exploratory paper-policy check, not a release permit.
- Real-provider fault testing, prospective strategy validation, independent profit proof and release certification are not established.

## Required follow-on work

1. Align feed observations with authenticated chain ancestry and transaction completeness.
2. Migrate legacy paper accounts into a single authoritative durable ledger, preserving existing economic history.
3. Independently compute UnifiedPipelineUnit decisions from sealed point-in-time inputs and compare actual outcomes.
4. Build executable quote/fee/exitability research and crash/overload qualification.
5. Only after exact-build evidence is independently reviewed consider a paper qualification.

**Never interpret successful source tests or CI as live-capital authorization.**
