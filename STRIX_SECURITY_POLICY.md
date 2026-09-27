# Strix Security Scanning Policy

Strix is used as an advisory-and-gating source-code security review for
SYLPH-FUSION. It has no execution, signing, capital, deployment, or repository
write authority.

## Allowed scope

- The checked-out repository source on pull requests and manually dispatched
  scans.
- A future disposable paper-only test environment after an explicit review.

## Forbidden scope

- `.env` files, keypairs, signing services, wallet material, provider tokens,
  and production credentials.
- Mainnet, public endpoints, live execution, or authenticated operator routes.
- Automatic remediation, merges, pushes, deployment, or changes to release
  gates without human review.

## Operational requirements

- Store `STRIX_LLM` and `STRIX_LLM_API_KEY` as GitHub Actions secrets.
- Review findings before changing code or treating a result as verified.
- Keep scan artifacts private and retain them for seven days.
- Investigate high and critical validated findings before merging.
- Fork pull requests do not run Strix automatically because GitHub does not
  expose repository secrets to them.
