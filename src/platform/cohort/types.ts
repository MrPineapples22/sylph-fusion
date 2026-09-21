export interface VaultAllocationRequest {
  vaultId: string;
  userId: string;
  authorizedAmountLamports: bigint;
  priorityScore: number;
}

export interface CohortVaultAllocation {
  vaultId: string;
  allocatedCapitalLamports: bigint;
  allocationPct: number;
  tokensFilled?: bigint;
  netLamportsSpent?: bigint;
  vwapPriceSolPerToken?: number;
}

export interface TradeCohort {
  cohortId: string;
  mint: string;
  totalRequestedCapitalLamports: bigint;
  approvedMarketCapacityLamports: bigint;
  totalAllocatedCapitalLamports: bigint;
  allocations: CohortVaultAllocation[];
  executed: boolean;
  actualTotalTokensFilled?: bigint;
  actualTotalLamportsSpent?: bigint;
  aggregateVwap?: number;
  createdAt: number;
}
