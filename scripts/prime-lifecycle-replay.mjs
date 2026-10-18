#!/usr/bin/env node
/** Read-only PRIME replay. Research accounting uses floating-point USD; never trading authority. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLOSE = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
const money = x => Math.round(x * 1e8) / 1e8;
function check(ok, reason) { if (!ok) throw new Error(reason); }
function positive(n, name) { check(typeof n === 'number' && Number.isFinite(n) && n > 0, `Invalid ${name}`); }
function nonnegative(n, name) { check(typeof n === 'number' && Number.isFinite(n) && n >= 0, `Invalid ${name}`); }
function time(n, name) { check(Number.isSafeInteger(n) && n > 0, `Invalid ${name}`); }
const ratioPct = (a, b) => b > 0 ? money(100 * a / b) : null;

function validate(o) {
  check(o && typeof o === 'object' && !Array.isArray(o), 'Opportunity must be an object');
  for (const key of ['id', 'mint', 'symbol']) check(typeof o[key] === 'string' && o[key].trim(), `Missing ${key}`);
  check(o.signal && typeof o.signal === 'object', `${o.id}: missing signal`);
  time(o.signal.atMs, `${o.id}.signal.atMs`);
  time(o.signal.receivedAtMs, `${o.id}.signal.receivedAtMs`);
  check(o.signal.receivedAtMs >= o.signal.atMs, `${o.id}: signal received before creation`);
  positive(o.signal.referencePriceUsd, `${o.id}.signal.referencePriceUsd`);
  positive(o.budgetUsd, `${o.id}.budgetUsd`);
  time(o.horizonEndMs, `${o.id}.horizonEndMs`);
  check(o.horizonEndMs > o.signal.receivedAtMs, `${o.id}: horizon must exceed signal reception`);
  check(Array.isArray(o.quotes) && Array.isArray(o.fills), `${o.id}: quotes/fills arrays required`);
  const seen = new Set();
  for (const q of o.quotes) {
    check(typeof q.id === 'string' && q.id && !seen.has(q.id), `${o.id}: duplicate/missing quote id`); seen.add(q.id);
    check(['BUY', 'SELL'].includes(q.side), `${o.id}: invalid quote side`);
    for (const t of ['quotedAtMs','availableAtMs','expiresAtMs']) time(q[t], `${o.id}.quote.${t}`);
    check(q.quotedAtMs <= q.availableAtMs && q.availableAtMs <= q.expiresAtMs, `${o.id}: impossible quote timing`);
    check(typeof q.provider === 'string' && q.provider.trim() && typeof q.routeId === 'string' && q.routeId.trim(), `${o.id}: missing route provenance`);
    check(typeof q.simulatedOk === 'boolean', `${o.id}: simulatedOk must be explicit`);
    nonnegative(q.feeUsd, `${o.id}.quote.feeUsd`);
    if (q.side === 'BUY') { positive(q.inputUsd, 'BUY.inputUsd'); positive(q.outputTokenQty, 'BUY.outputTokenQty'); }
    else { positive(q.inputTokenQty, 'SELL.inputTokenQty'); positive(q.outputUsd, 'SELL.outputUsd'); }
  }
  seen.clear();
  for (const f of o.fills) {
    check(typeof f.id === 'string' && f.id && !seen.has(f.id), `${o.id}: duplicate/missing fill id`); seen.add(f.id);
    check(['BUY', 'SELL'].includes(f.side), `${o.id}: invalid fill side`);
    check(['CHAIN_FINALIZED', 'PAPER'].includes(f.kind), `${o.id}: fill kind must be CHAIN_FINALIZED or PAPER`);
    time(f.atMs, `${o.id}.fill.atMs`); time(f.observedAtMs, `${o.id}.fill.observedAtMs`);
    check(f.observedAtMs >= f.atMs, `${o.id}: fill observed before settlement`);
    check(f.atMs >= o.signal.atMs && f.atMs <= o.horizonEndMs, `${o.id}: fill outside horizon`);
    positive(f.tokenQty, `${o.id}.fill.tokenQty`);
    positive(f.grossUsd, `${o.id}.fill.grossUsd`);
    nonnegative(f.feeUsd, `${o.id}.fill.feeUsd`);
    if (f.side === 'SELL') check(f.grossUsd >= f.feeUsd, `${o.id}: sell fee exceeds proceeds`);
    if (f.kind === 'CHAIN_FINALIZED') check(typeof f.signature === 'string' && f.signature.trim(), `${o.id}: chain finality needs signature`);
  }
}

function quoteEligible(q, minAvailableAtMs, maxTimeMs, submitDelayMs) {
  return q.simulatedOk && q.availableAtMs >= minAvailableAtMs && q.availableAtMs + submitDelayMs <= q.expiresAtMs &&
    q.availableAtMs + submitDelayMs <= maxTimeMs && q.quotedAtMs <= maxTimeMs;
}
function buyQuoteForBudget(q, usd) { return q.side === 'BUY' && CLOSE(q.inputUsd, usd); }
function sellQuoteForQty(q, qty) { return q.side === 'SELL' && CLOSE(q.inputTokenQty, qty); }
function pctOf(ref, observed) { return ref > 0 ? money((observed / ref - 1) * 100) : null; }

export function replayPrimeOpportunity(o, options = {}) {
  validate(o);
  const submitDelayMs = options.submitDelayMs ?? 500;
  const maxTerminalQuoteAgeMs = options.maxTerminalQuoteAgeMs ?? 30000;
  const maxCoverageGapMs = options.maxCoverageGapMs ?? 30000;
  for (const [name, n] of Object.entries({submitDelayMs,maxTerminalQuoteAgeMs,maxCoverageGapMs})) nonnegative(n, name);
  const quotes = [...o.quotes].sort((a,b) => a.availableAtMs - b.availableAtMs || a.id.localeCompare(b.id));
  const fills = [...o.fills].sort((a,b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  const start = o.signal.receivedAtMs;
  const eligible = quotes.filter(q => quoteEligible(q, start, o.horizonEndMs, submitDelayMs));
  const entries = eligible.filter(q => buyQuoteForBudget(q, o.budgetUsd));
  const earliestEntry = entries[0] ?? null;
  const buyFills = fills.filter(f => f.side === 'BUY');
  const sellFills = fills.filter(f => f.side === 'SELL');
  const warnings = [];
  const evidence = {
    quoteCount: quotes.length, eligibleQuoteCount: eligible.length, finalizedFillCount: fills.filter(f=>f.kind === 'CHAIN_FINALIZED').length,
    paperFillCount: fills.filter(f=>f.kind === 'PAPER').length,
    provenance: 'USER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED',
  };
  // One logical position: scale-ins must precede any sell. All fills must be causally in the same signal's inventory.
  check(!sellFills.length || buyFills.length, `${o.id}: cannot sell without entry`);
  const firstSell = sellFills[0]?.atMs ?? Infinity;
  check(buyFills.every(f => f.atMs <= firstSell), `${o.id}: buy after first sale requires separate trade lifecycle`);
  const buyQty = buyFills.reduce((n,f)=>n+f.tokenQty,0);
  const soldQty = sellFills.reduce((n,f)=>n+f.tokenQty,0);
  check(soldQty <= buyQty + 1e-8 * Math.max(1,buyQty), `${o.id}: oversold inventory`);
  const remainingQty = Math.max(0, buyQty-soldQty);
  const grossEntryCost = buyFills.reduce((n,f)=>n+f.grossUsd+f.feeUsd,0);
  const realizedProceeds = sellFills.reduce((n,f)=>n+f.grossUsd-f.feeUsd,0);
  const avgEntry = buyQty > 0 ? grossEntryCost / buyQty : null;
  const lastEntryMs = buyFills.at(-1)?.atMs ?? null;
  const analysisEntry = buyQty > 0 ? {atMs:lastEntryMs,tokenQty:buyQty,totalCostUsd:grossEntryCost,kind:'RECORDED_FILLS'} :
    earliestEntry ? {atMs:earliestEntry.availableAtMs+submitDelayMs,tokenQty:earliestEntry.outputTokenQty,
      totalCostUsd:earliestEntry.inputUsd+earliestEntry.feeUsd,kind:'MODELED_FROM_QUOTE'} : null;
  const exits = analysisEntry ? eligible.filter(q => sellQuoteForQty(q, analysisEntry.tokenQty) &&
      q.availableAtMs + submitDelayMs >= analysisEntry.atMs) : [];
  const bestExit = exits.length ? exits.reduce((best,q) => !best || (q.outputUsd - q.feeUsd > best.outputUsd - best.feeUsd) ? q : best, null) : null;
  const bestNet = bestExit && analysisEntry ? bestExit.outputUsd-bestExit.feeUsd-analysisEntry.totalCostUsd : null;
  const terminalSell = remainingQty > 0 ? [...eligible].reverse().find(q=>sellQuoteForQty(q,remainingQty) &&
    q.availableAtMs+submitDelayMs >= (lastEntryMs ?? 0) && o.horizonEndMs-q.availableAtMs <= maxTerminalQuoteAgeMs) ?? null : null;
  const realizedPnl = buyQty ? realizedProceeds - grossEntryCost * (soldQty / buyQty) : null;
  const closedPnl = buyQty && remainingQty <= 1e-8 * Math.max(1,buyQty) ? realizedProceeds - grossEntryCost : null;
  const finalPnl = closedPnl !== null ? closedPnl :
    (buyQty && terminalSell ? realizedProceeds + terminalSell.outputUsd-terminalSell.feeUsd-grossEntryCost : null);
  const finalReturnPct = finalPnl === null ? null : ratioPct(finalPnl,grossEntryCost);
  const coverageStamps = exits.map(q=>q.availableAtMs).sort((a,b)=>a-b);
  const coverageStart = analysisEntry?.atMs ?? 0;
  const observedGaps = coverageStamps.length ? [coverageStamps[0]-coverageStart,
    ...coverageStamps.slice(1).map((t,i)=>t-coverageStamps[i]), o.horizonEndMs-coverageStamps.at(-1)] : [];
  const coverageComplete = !!exits.length && Math.max(...observedGaps) <= maxCoverageGapMs;
  if (!earliestEntry) warnings.push('NO_SIZE_AWARE_ENTRY_QUOTE');
  if (!buyFills.length) warnings.push('NO_RECORDED_ENTRY_FILL');
  if (!exits.length) warnings.push('NO_FULL_SIZE_EXIT_QUOTE');
  if (exits.length && !coverageComplete) warnings.push('SPARSE_EXIT_COVERAGE');
  if (remainingQty && !terminalSell && buyFills.length) warnings.push('OPEN_INVENTORY_UNPRICED');
  if (fills.some(f=>f.kind==='PAPER')) warnings.push('PAPER_FILLS_NOT_CHAIN_EXECUTIONS');
  if (fills.some(f=>f.kind==='CHAIN_FINALIZED') && fills.some(f=>f.kind==='PAPER')) warnings.push('MIXED_EXECUTION_EVIDENCE');
  // Buy quote closest before first fill, valid for that fill time. Compare costs per token, not nominal prices.
  const firstBuy = buyFills[0] ?? null;
  const alignedQuote = firstBuy ? [...entries].reverse().find(q=>q.availableAtMs <= firstBuy.atMs && q.expiresAtMs >= firstBuy.atMs) ?? null : null;
  const entryPremiumPct = firstBuy && alignedQuote ? pctOf((alignedQuote.inputUsd+alignedQuote.feeUsd)/alignedQuote.outputTokenQty,
    (firstBuy.grossUsd+firstBuy.feeUsd)/firstBuy.tokenQty) : null;
  const quoteEntryUnitUsd = earliestEntry ? (earliestEntry.inputUsd+earliestEntry.feeUsd)/earliestEntry.outputTokenQty : null;
  const entryDriftPct = avgEntry !== null && quoteEntryUnitUsd !== null ? pctOf(quoteEntryUnitUsd,avgEntry) : null;
  const bestNetPct = bestNet === null ? null : ratioPct(bestNet,analysisEntry.totalCostUsd);
  const retentionGapUsd = bestNet !== null && finalPnl !== null ? money(bestNet-finalPnl) : null;
  // All classifications are research hypotheses, not proven root causes.
  const hypotheses = [];
  if (coverageComplete && bestNetPct !== null && bestNetPct <= 0) hypotheses.push('TOKEN_SELECTION_CANDIDATE');
  if (earliestEntry && firstBuy && firstBuy.atMs - earliestEntry.availableAtMs > (options.latencyThresholdMs ?? 5000) &&
    entryDriftPct !== null && entryDriftPct > (options.entryDragThresholdPct ?? 1)) hypotheses.push('SIGNAL_OR_ORDER_LATENCY_CANDIDATE');
  if (entryPremiumPct !== null && entryPremiumPct > (options.executionDragThresholdPct ?? 2)) hypotheses.push('ENTRY_EXECUTION_DRAG_CANDIDATE');
  if (coverageComplete && retentionGapUsd !== null && bestNet > 0 && retentionGapUsd > Math.max(0,analysisEntry.totalCostUsd * (options.retentionThresholdPct ?? 10)/100))
    hypotheses.push('PROFIT_RETENTION_CANDIDATE');
  if (!hypotheses.length) hypotheses.push('NOT_ATTRIBUTABLE_WITH_AVAILABLE_EVIDENCE');
  return {
    id:o.id,mint:o.mint,symbol:o.symbol,
    signal:{atMs:o.signal.atMs,receivedAtMs:start,referencePriceUsd:o.signal.referencePriceUsd,
      receptionDelayMs:start-o.signal.atMs},
    entryOpportunity:earliestEntry ? {quoteId:earliestEntry.id,availableAtMs:earliestEntry.availableAtMs,
      modeledArrivalMs:earliestEntry.availableAtMs+submitDelayMs,tokenQty:earliestEntry.outputTokenQty,
      costUsd:money(earliestEntry.inputUsd+earliestEntry.feeUsd),provider:earliestEntry.provider} : null,
    actualEntry:buyQty ? {firstFillAtMs:firstBuy.atMs,lastFillAtMs:lastEntryMs,quantity:buyQty,costUsd:money(grossEntryCost),
      weightedUnitCostUsd:avgEntry,mode:fills.some(f=>f.kind==='PAPER')?'INCLUDES_PAPER':'RECORDED_CHAIN_FINALIZED'} : null,
    bestObservedExit:bestExit ? {quoteId:bestExit.id,availableAtMs:bestExit.availableAtMs,
      netProceedsUsd:money(bestExit.outputUsd-bestExit.feeUsd),modeledNetPnlUsd:money(bestNet),
      modeledNetReturnPct:bestNetPct,provider:bestExit.provider,executionVerified:false} : null,
    actualExit:{sellFillCount:sellFills.length,quantitySold:soldQty,remainingQuantity:remainingQty,
      realizedProceedsUsd:money(realizedProceeds),realizedPnlUsd:realizedPnl===null?null:money(realizedPnl),
      terminalQuoteId:terminalSell?.id ?? null,finalNetPnlUsd:finalPnl===null?null:money(finalPnl),finalNetReturnPct:finalReturnPct,
      fullyClosed:buyQty>0 && remainingQty<=1e-8*Math.max(1,buyQty),
      finalEvidence:closedPnl!==null?'CLOSED_FILLS':terminalSell?'MARK_TO_SIZE_AWARE_QUOTE':'CENSORED'},
    decomposition:{firstFillVsContemporaneousQuotePct:entryPremiumPct,
      entryVsEarliestAvailableQuotePct:entryDriftPct,
      grossRetentionOpportunityUsd:retentionGapUsd,exitCoverageComplete:coverageComplete,
      maxObservedExitGapMs:observedGaps.length?Math.max(...observedGaps):null},
    evidence,warnings,hypotheses,
    disclaimer:'Post-entry best quote is a hindsight, route-size-aware modeled bound; not a guaranteed landing or realized gain.',
  };
}

export function replayPrime(input, options = {}) {
  check(input?.schema === 'sylph-prime-lifecycle-v1', 'Expected sylph-prime-lifecycle-v1');
  check(Array.isArray(input.opportunities) && input.opportunities.length > 0, 'Nonempty opportunities array required');
  const ids = input.opportunities.map(o=>o.id);
  check(new Set(ids).size === ids.length, 'Duplicate opportunity id');
  const opportunities = input.opportunities.map(o=>replayPrimeOpportunity(o,options));
  const counts = {};
  for (const r of opportunities) for (const h of r.hypotheses) counts[h]=(counts[h]??0)+1;
  return {schema:'sylph-prime-lifecycle-report-v1',purpose:'RESEARCH_ONLY',liveTradingAuthorized:false,
    config:{submitDelayMs:options.submitDelayMs??500,maxCoverageGapMs:options.maxCoverageGapMs??30000,
      maxTerminalQuoteAgeMs:options.maxTerminalQuoteAgeMs??30000},
    summary:{opportunities:opportunities.length,closedPositions:opportunities.filter(x=>x.actualExit.fullyClosed).length,
      censoredPositions:opportunities.filter(x=>x.actualExit.finalEvidence==='CENSORED').length,
      hypothesisCounts:counts},opportunities};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [inPath,outPath] = process.argv.slice(2);
    check(inPath, 'Usage: node scripts/prime-lifecycle-replay.mjs <input.json> [output.json]');
    const raw = readFileSync(resolve(inPath),'utf8');
    const report = replayPrime(JSON.parse(raw));
    report.inputSha256 = createHash('sha256').update(raw).digest('hex');
    const serialized = JSON.stringify(report,null,2)+'\n';
    if (outPath) {writeFileSync(resolve(outPath),serialized,{flag:'wx'});console.log(`Saved ${resolve(outPath)}`);}
    else process.stdout.write(serialized);
  } catch (error) { console.error(`PRIME_REPLAY_FAILED: ${error.message}`); process.exitCode=1; }
}
