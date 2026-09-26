import { createHash } from 'node:crypto';

/** Canonical, protocol-neutral lifecycle reducer. It is intentionally read/analyze only. */
export type LaunchLifecyclePhase = 'DISCOVERED' | 'CURVE_INITIALIZING' | 'BONDING_CURVE_ACTIVE' | 'CURVE_NEAR_COMPLETE' |
  'CURVE_COMPLETE' | 'MIGRATION_TRIGGERED' | 'MIGRATION_VERIFYING' | 'DESTINATION_DISCOVERED' | 'DESTINATION_VERIFYING' |
  'DEX_ACTIVE' | 'POST_GRADUATION_ACTIVE' | 'MIGRATION_UNVERIFIED' | 'PROTOCOL_ERROR';
export type EvidenceState = 'KNOWN' | 'UNKNOWN' | 'STALE' | 'UNAVAILABLE' | 'CONFLICTED';
export interface LifecycleEvidence { readonly eventId: string; readonly provider: string; readonly slot: number; readonly eventTime: number; readonly observedTime: number; readonly rawPayloadHash: string; readonly decoderVersion: string; }
export interface DestinationPoolCertificate { readonly pool: string; readonly protocol: string; readonly mint: string; readonly relatedMigrationEventId: string; readonly verifiedAt: number; readonly evidenceIds: readonly string[]; }
export interface LaunchLifecycleState {
  readonly tokenId: string; readonly protocol: 'PUMP_FUN' | 'ORYNTH' | 'UNKNOWN'; readonly lifecycle: LaunchLifecyclePhase;
  readonly stateVersion: number; readonly lastSlot: number; readonly updatedAt: number; readonly stateHash: string;
  readonly curve: { readonly progressBps: number | null; readonly complete: boolean; readonly completionSlot?: number; readonly completionSignature?: string };
  readonly migration: { readonly verificationState: 'NOT_STARTED' | 'DISCOVERING' | 'VERIFYING' | 'VERIFIED' | 'UNVERIFIED' | 'FAILED'; readonly detectedAt?: number; readonly detectedSlot?: number; readonly destinationProtocol?: string; readonly destinationPool?: string; };
  readonly destination?: DestinationPoolCertificate; readonly evidence: readonly LifecycleEvidence[];
}
export interface LifecycleTransition { readonly event: LifecycleEvidence; readonly phase: LaunchLifecyclePhase; readonly progressBps?: number | null; readonly completionSignature?: string; readonly destination?: DestinationPoolCertificate; }
export interface TransitionResult { readonly state: LaunchLifecycleState; readonly applied: boolean; readonly reason?: 'DUPLICATE_EVENT' | 'STALE_CALLBACK' | 'ILLEGAL_TRANSITION' | 'INVALID_EVIDENCE' | 'DESTINATION_UNVERIFIED'; }
const allowed: Readonly<Record<LaunchLifecyclePhase, readonly LaunchLifecyclePhase[]>> = Object.freeze({
  DISCOVERED: ['CURVE_INITIALIZING','BONDING_CURVE_ACTIVE','PROTOCOL_ERROR'], CURVE_INITIALIZING: ['BONDING_CURVE_ACTIVE','PROTOCOL_ERROR'],
  BONDING_CURVE_ACTIVE: ['CURVE_NEAR_COMPLETE','CURVE_COMPLETE','PROTOCOL_ERROR'], CURVE_NEAR_COMPLETE: ['CURVE_COMPLETE','PROTOCOL_ERROR'],
  CURVE_COMPLETE: ['MIGRATION_TRIGGERED','MIGRATION_VERIFYING','PROTOCOL_ERROR'], MIGRATION_TRIGGERED: ['MIGRATION_VERIFYING','DESTINATION_DISCOVERED','MIGRATION_UNVERIFIED','PROTOCOL_ERROR'],
  MIGRATION_VERIFYING: ['DESTINATION_DISCOVERED','MIGRATION_UNVERIFIED','PROTOCOL_ERROR'], DESTINATION_DISCOVERED: ['DESTINATION_VERIFYING','MIGRATION_UNVERIFIED','PROTOCOL_ERROR'],
  DESTINATION_VERIFYING: ['DEX_ACTIVE','MIGRATION_UNVERIFIED','PROTOCOL_ERROR'], DEX_ACTIVE: ['POST_GRADUATION_ACTIVE','PROTOCOL_ERROR'],
  POST_GRADUATION_ACTIVE: ['PROTOCOL_ERROR'], MIGRATION_UNVERIFIED: ['DESTINATION_DISCOVERED','DESTINATION_VERIFYING','PROTOCOL_ERROR'], PROTOCOL_ERROR: [],
});
const hash = (state: Omit<LaunchLifecycleState, 'stateHash'>) => createHash('sha256').update(JSON.stringify(state)).digest('hex');
const freeze = (state: Omit<LaunchLifecycleState, 'stateHash'>): LaunchLifecycleState => Object.freeze({...state, evidence: Object.freeze([...state.evidence]), stateHash: hash(state)});
export function initialLaunchLifecycle(tokenId: string, protocol: LaunchLifecycleState['protocol'] = 'UNKNOWN', at = Date.now()): LaunchLifecycleState {
  if (!tokenId || !Number.isSafeInteger(at) || at <= 0) throw new Error('Invalid lifecycle identity/time');
  return freeze({tokenId, protocol, lifecycle:'DISCOVERED', stateVersion:0, lastSlot:0, updatedAt:at, curve:{progressBps:null,complete:false}, migration:{verificationState:'NOT_STARTED'}, evidence:[]});
}
/** Fixed-point progress calculation; callers must supply protocol-decoded cumulative quote and threshold in identical units. */
export function calculateCurveProgressBps(completedQuote: bigint, completionThreshold: bigint): number | null {
  if (completedQuote < 0n || completionThreshold <= 0n) return null;
  return Number((completedQuote * 10_000n / completionThreshold) > 10_000n ? 10_000n : completedQuote * 10_000n / completionThreshold);
}
const validEvidence = (e: LifecycleEvidence) => !!e.eventId && !!e.provider && !!e.rawPayloadHash && !!e.decoderVersion && Number.isSafeInteger(e.slot) && e.slot >= 0 && Number.isSafeInteger(e.eventTime) && Number.isSafeInteger(e.observedTime) && e.observedTime >= e.eventTime;
export function reduceLaunchLifecycle(previous: LaunchLifecycleState, transition: LifecycleTransition): TransitionResult {
  const {event, phase} = transition;
  if (!validEvidence(event)) return {state:previous, applied:false, reason:'INVALID_EVIDENCE'};
  if (previous.evidence.some(x => x.eventId === event.eventId)) return {state:previous, applied:false, reason:'DUPLICATE_EVENT'};
  if (event.slot < previous.lastSlot) return {state:previous, applied:false, reason:'STALE_CALLBACK'};
  if (!allowed[previous.lifecycle].includes(phase)) return {state:previous, applied:false, reason:'ILLEGAL_TRANSITION'};
  if ((phase === 'DEX_ACTIVE' || phase === 'POST_GRADUATION_ACTIVE') && (!transition.destination || transition.destination.mint !== previous.tokenId || !transition.destination.evidenceIds.length)) return {state:previous, applied:false, reason:'DESTINATION_UNVERIFIED'};
  const complete = previous.curve.complete || phase === 'CURVE_COMPLETE' || phase === 'MIGRATION_TRIGGERED' || phase === 'MIGRATION_VERIFYING' || phase === 'DESTINATION_DISCOVERED' || phase === 'DESTINATION_VERIFYING' || phase === 'DEX_ACTIVE' || phase === 'POST_GRADUATION_ACTIVE';
  const verificationState = phase === 'MIGRATION_VERIFYING' ? 'VERIFYING' : phase === 'MIGRATION_UNVERIFIED' ? 'UNVERIFIED' : phase === 'DEX_ACTIVE' || phase === 'POST_GRADUATION_ACTIVE' ? 'VERIFIED' : phase === 'DESTINATION_DISCOVERED' || phase === 'DESTINATION_VERIFYING' || phase === 'MIGRATION_TRIGGERED' ? 'DISCOVERING' : previous.migration.verificationState;
  const next = freeze({tokenId:previous.tokenId, protocol:previous.protocol, lifecycle:phase, stateVersion:previous.stateVersion + 1, lastSlot:event.slot, updatedAt:event.observedTime,
    curve:{progressBps: complete ? 10_000 : transition.progressBps ?? previous.curve.progressBps, complete, ...(phase === 'CURVE_COMPLETE' ? {completionSlot:event.slot, completionSignature:transition.completionSignature} : previous.curve.completionSlot ? {completionSlot:previous.curve.completionSlot, completionSignature:previous.curve.completionSignature} : {})},
    migration:{verificationState, ...(complete ? {detectedAt:previous.migration.detectedAt ?? event.observedTime, detectedSlot:previous.migration.detectedSlot ?? event.slot} : {}), ...(transition.destination ? {destinationProtocol:transition.destination.protocol,destinationPool:transition.destination.pool} : previous.migration.destinationPool ? {destinationProtocol:previous.migration.destinationProtocol,destinationPool:previous.migration.destinationPool} : {})},
    ...(transition.destination ? {destination:Object.freeze({...transition.destination,evidenceIds:Object.freeze([...transition.destination.evidenceIds])})} : previous.destination ? {destination:previous.destination} : {}), evidence:[...previous.evidence,event]});
  return {state:next, applied:true};
}
/** Missing destination evidence during a verified transition is unknown, never zero and never death. */
export function effectiveLiquidityState(state: LaunchLifecycleState, bondingCurveLiquidity: number | null, destinationLiquidity: number | null): EvidenceState {
  if (['CURVE_COMPLETE','MIGRATION_TRIGGERED','MIGRATION_VERIFYING','DESTINATION_DISCOVERED','DESTINATION_VERIFYING'].includes(state.lifecycle) && destinationLiquidity === null) return 'UNKNOWN';
  if (destinationLiquidity === null && bondingCurveLiquidity === null) return 'UNKNOWN';
  return 'KNOWN';
}
export function migrationBarrierPreventsFalseDeath(state: LaunchLifecycleState, bondingCurveLiquidity: number | null, destinationLiquidity: number | null): boolean {
  return effectiveLiquidityState(state, bondingCurveLiquidity, destinationLiquidity) === 'UNKNOWN' && ['CURVE_COMPLETE','MIGRATION_TRIGGERED','MIGRATION_VERIFYING','DESTINATION_DISCOVERED','DESTINATION_VERIFYING'].includes(state.lifecycle);
}
