# SOL/SYLPH Engineering Agent Organization

This is the project task-routing charter. It applies to humans and AI agents. It does not grant financial, signer, deployment, or production-release authority.

## Tiers and routing

Every task must be classified before work starts:

```ts
type TaskClassification = {
  complexity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  financialImpact: 'NONE' | 'INDIRECT' | 'DIRECT';
  architectureImpact: 'NONE' | 'LOCAL' | 'SYSTEMIC';
  securityImpact: 'NONE' | 'LOCAL' | 'SYSTEMIC';
  uncertainty: 'LOW' | 'MEDIUM' | 'HIGH';
  reversibility: 'EASY' | 'COSTLY' | 'IRREVERSIBLE';
  blastRadius: 'LOCAL' | 'SERVICE' | 'SYSTEM';
  requiredEvidence: string[];
};
```

| Tier | Route | Scope |
|---|---|---|
| LOW | deterministic tool or script | formatting, enumeration, mechanical migrations, simple tests |
| MEDIUM | named Sol agent | bounded engineering with no financial authority or core-state ownership change |
| HIGH | responsible Astra specialty | architecture, protocol meaning, safety, verification, or model-governance changes |
| CRITICAL | authoring Astra plus independent Astra reviewer | signer, execution authority, capital constraints, canonical state, or certification |

Consequences, not task size, determine the route. A deterministic invariant wins every disagreement with a model or agent conclusion.

## Sol tier (medium-complexity implementation)

| Agent | Responsibility | Allowed files | Prohibited authority | Escalate when |
|---|---|---|---|---|
| Sol Integration | adapters, REST/WSS clients, schemas, retries, cache contracts | `src/platform/`, `src/feed.ts`, adapter tests | provider may not authorize a trade or define canonical chain truth | semantic, signer, or provider-independence claim changes |
| Sol Data | evidence envelopes, journals, provenance, replay preparation | `src/intelligence/evidence/`, `src/intelligence/truth/`, data tests | may not redefine canonical financial balances | ownership, replay, or bitemporal behavior changes |
| Sol UI | read-only dashboard, accessibility, interaction states | `terminal/`, `ui/`, projection tests | may not create authority, fabricate state, or bypass command gateway | a UI action changes capital or safety semantics |
| Sol QA | fixtures, regression and integration tests | `test/`, test fixtures | may not waive a failed release gate | test exposes systemic invariant failure |
| Sol Provider | provider health, quotas, failover validation | `src/platform/ingestion/`, provider tests | may not label an untested source a fallback | primary truth or cross-provider independence changes |
| Sol Research | bounded API/protocol research and implementation notes | research notes and non-authoritative docs | may not convert research into runtime authority | research affects protocol semantics or economics |
| Sol Performance | latency, memory, queues, cache and rendering | profiling scripts and bounded performance changes | may not weaken safety controls to improve throughput | a performance change alters ordering, durability, or execution |

## Astra tier (high-consequence review and ownership)

| Agent | Responsibility |
|---|---|
| Astra Architecture | dependency direction, system boundaries, canonical contracts, duplicate authority |
| Astra Protocol | protocol and economic semantics, migrations, token behavior, liquidity geometry |
| Astra Verification | invariants, deterministic replay, differential/property testing, certification evidence |
| Astra Intelligence | model authority, calibration, JEV/Laya/EINSTEIN integration, promotion and research validity |
| Astra Risk | signer boundary, execution, settlement, reconciliation, risk envelopes and recovery |
| Astra Certification | adversarial tests, incident scenarios, release gates and final certification |

Critical changes require: authoring Astra → independent Astra reviewer → reproducible verification evidence → release-gate decision. No agent may approve its own critical change.

## JEV/Laya specialization routing

| Agent | Tier | Responsibility | Forbidden authority |
|---|---|---|---|
| Sol-JEV Integration | MEDIUM | bounded inference wrapper, input/output normalization, health and latency metrics | risk, capital, signer, execution or provider-state mutation |
| Sol-Laya Integration | MEDIUM | controlled context assembly, timeout and version reporting | raw provider, filesystem/secret, command or wallet access |
| Sol-Feature | MEDIUM | feature definitions, missingness, normalization and tests | feature semantic changes without Astra Quant review |
| Sol-ModelOps | MEDIUM | registry storage, version pinning, shadow metrics | model promotion or release approval |
| Sol-Observability | MEDIUM | certificate/traces and dashboards | changing model outputs or policy |
| Astra-J1/J2/J3/J4/J5/J6 | HIGH/CRITICAL | architecture/quant/verification/safety/adversarial/certification reviews | self-approval of critical promotion or financial authority |

JEV/Laya change routing: feature or label semantics → Astra Quant + Verification; model authority or firewall → Astra Safety; promotion → Astra Certification; UI-only presentation → Sol UI; bounded adapter work → Sol-JEV or Sol-Laya Integration.

## Curve and migration specialization routing

| Agent | Tier | Responsibility | Forbidden authority |
|---|---|---|---|
| Sol-Curve Integration | MEDIUM | curve-account adapters, canonical progress integration | protocol semantic changes without Astra-C1/C2 review |
| Sol-Migration | MEDIUM | bounded discovery orchestration and provider adapters | destination-pool certification from indexer data alone |
| Sol-Data | MEDIUM | event journal, snapshots and replay fixtures | lifecycle policy changes |
| Sol-Feature / Sol-UI / Sol-QA | MEDIUM | post-grad features, projections and deterministic regressions | execution, signer or capital authority |
| Astra-C1/C2/C3/C4/C5/C6 | HIGH/CRITICAL | protocol/math/lifecycle/intelligence/safety/certification | self-approval of production promotion |

Curve progress formula and completion semantics require Astra-C1/C2 review. Lifecycle ownership, false-death behavior, or any route/execution effect requires independent Astra-C3/C5 review.

## External intelligence specialization routing

| Agent | Tier | Responsibility | Forbidden authority |
|---|---|---|---|
| Sol-Provider Integration | MEDIUM | adapters, auth boundaries, quotas, retry and schema validation | provider-specific facts outside adapter boundary |
| Sol-Provider Data | MEDIUM | evidence envelopes, revision lineage and raw archive adapters | evidence-time semantics without Astra-W2 review |
| Sol-EEQC / Sol-Freshness | MEDIUM | capability plans, selection and decision-specific freshness | provider authority hierarchy changes |
| Sol-Challenger / Sol-QA / Sol-Observability | MEDIUM | shadow comparisons, fixture faults, trace/health surfaces | automatic champion promotion |
| Astra-W1/W2/W3/W4/W5/W6 | HIGH/CRITICAL | architecture/evidence/protocol/sovereignty/adversarial/certification | self-approval of critical provider promotion |

New external sources begin as research-only until a capability contract, data-rights review, schema/failure tests, provenance, lineage, freshness, and an Astra release decision are present.

## Signing and mainnet-evidence routing

| Agent | Tier | Responsibility | Forbidden authority |
|---|---|---|---|
| Sol-Signing Integration | MEDIUM | request-client and non-secret evidence plumbing after reviewed service contract | private keys, KMS permission, broadcast implementation |
| Sol-Journal / Sol-Observability | MEDIUM | durable journal adapters, redacted evidence and UI status | release approval or mainnet ceremony |
| Sol-QA | MEDIUM | tamper, replay, expiry and fault fixtures | weaken any deny rule |
| Astra Signing/Risk/Verification/Certification | CRITICAL | signer topology, message semantics, authority/firewall review, release gate | self-approval or initiating a financial action |

No agent has wallet material, signer capability, mainnet broadcast authority, or permission to perform an operator ceremony. Those require explicit user authorization and a separately verified deployment.

## Delegation contract

Every assigned task includes:

```ts
type AgentTask = {
  objective: string;
  relevantFiles: string[];
  knownContext: string;
  inputs: string[];
  expectedOutputs: string[];
  dependencies: string[];
  invariants: string[];
  prohibitedChanges: string[];
  verificationRequired: string[];
  completionEvidence: string[];
};

type AgentResult = {
  workCompleted: string[];
  filesChanged: string[];
  testsAdded: string[];
  testsPassed: string[];
  evidence: string[];
  unresolvedIssues: string[];
  assumptions: string[];
  discoveredRisks: string[];
  recommendedEscalations: string[];
};
```

Compilation alone is not completion evidence. Agents must preserve existing user changes and must not make external financial actions, deployments, credential changes, or signer actions without explicit user authorization.
