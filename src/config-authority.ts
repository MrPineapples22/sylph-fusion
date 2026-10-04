/**
 * SOL-SYLPH Centralized Configuration Authority
 * Specification: Sections 2, 47, 69.
 *
 * One authoritative, versioned, hashable configuration owner.
 * Eliminates scattered constants across components and provides cryptographic
 * config fingerprints for every decision and audit record.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ConfigSchema = z.object({
  version: z.string().default('1.0.0'),
  environment: z.enum(['paper', 'live', 'shadow']).default('paper'),

  // Risk Thresholds
  maxPositions: z.number().int().min(1).max(20).default(3),
  maxExposureLamports: z.bigint().default(100_000_000n),
  maxDailyLossLamports: z.bigint().default(30_000_000n),
  maxSpeculativeRiskBps: z.number().int().min(10).max(1000).default(100),
  rollingDrawdownBps: z.number().int().min(100).max(5000).default(500),
  reserveLamports: z.bigint().default(30_000_000n),
  stopBps: z.number().int().min(100).max(5000).default(1200),
  trailingStopBps: z.number().int().min(100).max(5000).default(700),
  failureHaltCount: z.number().int().min(1).max(10).default(3),
  failureWindowMs: z.number().int().min(60_000).max(86_400_000).default(3_600_000),

  // Execution & Slippage Policy
  buyLamports: z.bigint().default(10_000_000n),
  slippageBps: z.number().int().min(1).max(3000).default(300),
  panicSlippageBps: z.number().int().min(100).max(10_000).default(1000),
  maxImpactBps: z.number().int().min(1).max(5000).default(500),
  maxFeeBps: z.number().int().min(1).max(5000).default(300),
  minTipLamports: z.bigint().default(10_000n),
  maxTipLamports: z.bigint().default(500_000n),
  maxPriorityLamports: z.bigint().default(200_000n),

  // Market Filter Thresholds
  minBuyers: z.number().int().min(1).max(100).default(5),
  minTxs: z.number().int().min(1).max(500).default(5),
  minLiqUsd: z.number().min(0).default(1000),
  minMcapUsd: z.number().min(0).default(5000),
  minRealReserveLamports: z.bigint().default(1_000_000_000n),
  liquidityDropBps: z.number().int().min(100).max(9000).default(2500),
  minAgeMs: z.number().int().min(0).default(10_000),
  maxAgeMs: z.number().int().min(10_000).default(180_000),
  minCreatorLamports: z.bigint().default(1_000_000n),
  maxCreatorBps: z.number().int().min(0).max(10_000).default(500),
  maxTopTenBps: z.number().int().min(0).max(10_000).default(3000),

  // Manipulation & Security
  maxRugScore: z.number().min(0).default(50),
  dangerRugScore: z.number().min(0).default(101),
  bundlerWindowMs: z.number().int().min(1000).default(30_000),
  bundlerThreshold: z.number().int().min(1).default(3),
  maxWalletTrack: z.number().int().min(1).default(50),

  // HSI Parameters
  minHsiScore: z.number().min(0).max(100).default(50),
  hsiAlpha: z.number().min(0.01).max(1.0).default(0.5),

  // Temporal & Stale Thresholds
  graceSeconds: z.number().int().min(1).default(60),
  sweeper5mSeconds: z.number().int().min(10).default(300),
  timeout3hSeconds: z.number().int().min(60).default(10_800),
  feedStaleMs: z.number().int().min(1000).default(10_000),
  quoteMaxAgeMs: z.number().int().min(250).default(3000),
  rpcTimeoutMs: z.number().int().min(500).default(4000),
  pollMs: z.number().int().min(100).default(1000),

  // Queue & Ingestion Capacity
  maxQueue: z.number().int().min(1).default(32),
  maxTracked: z.number().int().min(10).default(500),

  // Model & Strategy Metadata
  modelVersion: z.string().default('sylph-model-v2.5'),
  strategyVersion: z.string().default('champion-v2.5'),
  featuresVersion: z.string().default('v1.4'),

  // Default Market Reference
  solPriceUsdDefault: z.number().default(150.0),
});

export type SystemConfig = z.infer<typeof ConfigSchema>;

export const PROTECTED_CONFIG_KEYS = new Set<string>([
  'environment',
  'maxPositions',
  'maxExposureLamports',
  'maxDailyLossLamports',
  'maxSpeculativeRiskBps',
  'rollingDrawdownBps',
  'reserveLamports',
  'stopBps',
  'trailingStopBps',
  'failureHaltCount',
  'failureWindowMs',
  'buyLamports',
  'slippageBps',
  'panicSlippageBps',
  'maxImpactBps',
  'maxFeeBps',
  'minTipLamports',
  'maxTipLamports',
  'maxPriorityLamports',
]);

export interface ConfigChangeProposal {
  readonly proposalId: string;
  readonly proposerId: string;
  readonly patch: Partial<SystemConfig>;
  readonly rationale: string;
  readonly epoch: number;
  readonly tribunalApprovalDigest?: string;
  readonly tribunalSignature?: string;
}

export class ConfigAuthority {
  private static instance: ConfigAuthority | null = null;
  private currentConfig: SystemConfig;
  private currentHash: string;
  private currentEpoch: number = 1;

  private constructor(initialConfig?: Partial<SystemConfig>, initialEpoch: number = 1) {
    this.currentConfig = ConfigSchema.parse(initialConfig || {});
    this.currentHash = this.computeHash(this.currentConfig);
    this.currentEpoch = initialEpoch;
  }

  public static getInstance(initialConfig?: Partial<SystemConfig>): ConfigAuthority {
    if (!ConfigAuthority.instance) {
      ConfigAuthority.instance = new ConfigAuthority(initialConfig);
    }
    return ConfigAuthority.instance;
  }

  public static resetInstance(newConfig?: Partial<SystemConfig>, proposal?: ConfigChangeProposal): ConfigAuthority {
    if (ConfigAuthority.instance && newConfig) {
      const keys = Object.keys(newConfig);
      const modifiesProtected = keys.some(k => PROTECTED_CONFIG_KEYS.has(k));
      if (modifiesProtected && (!proposal || !proposal.tribunalSignature)) {
        throw new Error('CONFIG_GOVERNANCE_VIOLATION: Cannot reset authority-sensitive config without signed Tribunal proposal');
      }
    }
    const nextEpoch = ConfigAuthority.instance ? ConfigAuthority.instance.currentEpoch + 1 : 1;
    ConfigAuthority.instance = new ConfigAuthority(newConfig, nextEpoch);
    return ConfigAuthority.instance;
  }

  public getConfig(): Readonly<SystemConfig> {
    return Object.freeze({ ...this.currentConfig });
  }

  public getConfigHash(): string {
    return this.currentHash;
  }

  public getConfigRoot(): string {
    return this.currentHash;
  }

  public getConfigEpoch(): number {
    return this.currentEpoch;
  }

  public updateConfig(
    patch: Partial<SystemConfig>,
    proposal?: ConfigChangeProposal
  ): { previousHash: string; newHash: string; epoch: number } {
    const keys = Object.keys(patch);
    const modifiesProtected = keys.some(k => PROTECTED_CONFIG_KEYS.has(k));

    if (modifiesProtected) {
      if (!proposal) {
        throw new Error('CONFIG_GOVERNANCE_VIOLATION: Mutation of protected keys requires a signed ConfigChangeProposal approved by Tribunal');
      }
      if (!proposal.tribunalSignature || proposal.tribunalSignature.length === 0) {
        throw new Error('CONFIG_GOVERNANCE_VIOLATION: ConfigChangeProposal missing valid Tribunal approval signature');
      }
      if (proposal.epoch !== this.currentEpoch) {
        throw new Error(`CONFIG_GOVERNANCE_VIOLATION: Stale config proposal epoch ${proposal.epoch} != current epoch ${this.currentEpoch}`);
      }
    }

    const previousHash = this.currentHash;
    const merged = { ...this.currentConfig, ...patch };
    this.currentConfig = ConfigSchema.parse(merged);
    this.currentHash = this.computeHash(this.currentConfig);
    this.currentEpoch += 1;
    return { previousHash, newHash: this.currentHash, epoch: this.currentEpoch };
  }

  private computeHash(cfg: SystemConfig): string {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(cfg).sort()) {
      const val = (cfg as any)[key];
      normalized[key] = typeof val === 'bigint' ? val.toString() : val;
    }
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }
}

export const globalConfigAuthority = ConfigAuthority.getInstance();

