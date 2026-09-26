# AI Security Boundary

The JEV/Laya pilot imports only Node cryptography plus the feature contract. It has no direct provider, HTTP, file, wallet, signer, command-gateway, capital, risk, or execution dependency.

Before any service deployment, require explicit authenticated gateway access, rate limits, access logs, redacted projection APIs, model-artifact integrity checks, and extraction/poisoning threat tests. Never expose feature weights, decision thresholds, private entity labels, model artifacts, or proprietary training data by default.

