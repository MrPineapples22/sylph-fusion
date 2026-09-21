import { parseHand, formatHand } from './core/hand.ts';
import { solveHandOracle } from './engine_a/oracle.ts';
import { rationalToDecimalString, rationalToNumber } from './core/rational.ts';
import { compileDecisionPacket } from './strategy/compiler.ts';
import { runBenchmarkSuite } from './verification/benchmarks.ts';
import { runMutationTestSuite } from './verification/mutation.ts';
import { runDifferentialCheck } from './verification/differential.ts';
import { verifyDenominatorConservation, verifyCardOrderInvariance, verifySuitIsomorphismInvariance } from './verification/invariants.ts';
import { getCanonicalHandKey } from './verification/canonical_reduction.ts';
import { VideoPokerSimulator } from './simulation/simulator.ts';

function printHelp() {
  console.log(`
JACKS ONE — Certified Truth Kernel & Oracle CLI
Usage:
  node --experimental-strip-types src/cli.ts <command> [args]

Commands:
  eval <cards...>       Evaluate a 5-card hand (e.g. "As Ks Qs Js 9c")
  benchmarks            Run the canonical 9/6 strategy benchmark suite
  verify [hand]         Run differential and invariant verification
  mutate                Run mutation testing suite against intentional defects
  canonical             Verify the 2,598,960 -> 134,459 canonical hand reduction
  simulate [rounds=1000] Run simulation to validate RTP and variance
  help                  Show this help message
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'eval': {
      const cardTokens = args.slice(1);
      if (cardTokens.length < 5) {
        console.error('Error: Please provide 5 cards (e.g., node src/cli.ts eval As Ks Qs Js 9c)');
        process.exit(1);
      }
      const hand = parseHand(cardTokens);
      console.log(`\nEvaluating Hand: ${formatHand(hand, true)} (${formatHand(hand)})`);
      const packet = compileDecisionPacket(hand);

      console.log(`\n======================================================`);
      console.log(`CERTIFIED DECISION PACKET [${packet.certificate_id}]`);
      console.log(`Ruleset: ${packet.ruleset_id}`);
      console.log(`======================================================`);
      console.log(`SELECTED OPTIMAL HOLD: [${packet.selected_hold.held_cards.join(' ') || 'DISCARD ALL'}] (mask: ${packet.selected_hold.mask})`);
      console.log(`Exact EV:              ${packet.exact_ev.numerator} / ${packet.exact_ev.denominator} = ${packet.exact_ev.decimal_approx.toFixed(6)} coins`);
      console.log(`EV Gap to 2nd best:    +${packet.ev_gap.decimal_approx.toFixed(6)} coins`);
      console.log(`Decision Category:     ${packet.explanation_data.category_label}`);
      console.log(`Strategy Rationale:    ${packet.explanation_data.rule_name}`);
      console.log(`Calculation Hash:      ${packet.certificate_hash}`);

      console.log(`\nTop 5 Alternative Holds:`);
      for (let i = 0; i < Math.min(5, packet.alternative_evs.length); i++) {
        const alt = packet.alternative_evs[i];
        console.log(`  #${alt.rank}: Hold [${alt.held_cards.join(' ').padEnd(14)}] EV = ${alt.exact_ev.decimal_approx.toFixed(6)}`);
      }
      break;
    }

    case 'benchmarks': {
      console.log('\nRunning Canonical Strategy Benchmark Suite...');
      const res = runBenchmarkSuite();
      for (const r of res.results) {
        console.log(`  [${r.success ? 'PASS' : 'FAIL'}] ${r.id} ${r.name.padEnd(45)} Held: ${r.actualHeld.join(' ').padEnd(12)} EV: ${r.ev.toFixed(4)}`);
      }
      console.log(`\nResult: ${res.passed} / ${res.total} benchmarks passed.`);
      break;
    }

    case 'verify': {
      const cardTokens = args.slice(1);
      const handStr = cardTokens.length >= 5 ? cardTokens.join(' ') : 'As Ks Qs Js 9c';
      const hand = parseHand(handStr);

      console.log(`\nRunning Verification Pipeline on Hand: ${formatHand(hand)}`);
      console.log('\n1. Differential Check (Engine A vs Engine B):');
      const diff = runDifferentialCheck(hand);
      console.log(`   Engine Agreement: ${diff.fullAgreement ? 'PERFECT (32/32 holds matched)' : 'FAILED'}`);

      console.log('\n2. Invariant Checks:');
      const denom = verifyDenominatorConservation(hand);
      const denomPass = denom.every((d) => d.passed);
      console.log(`   Denominator Conservation: ${denomPass ? 'PASSED (all 32 hold combinations match C(47, 5-k))' : 'FAILED'}`);

      const order = verifyCardOrderInvariance(hand);
      console.log(`   Card Order Invariance:   ${order.passed ? 'PASSED' : 'FAILED'}`);

      const suit = verifySuitIsomorphismInvariance(hand);
      console.log(`   Suit Isomorphism Invar:  ${suit.passed ? 'PASSED' : 'FAILED'}`);
      break;
    }

    case 'mutate': {
      console.log('\nRunning Mutation Testing Harness...');
      const res = runMutationTestSuite();
      for (const r of res.results) {
        console.log(`  [${r.killed ? 'KILLED' : 'SURVIVED'}] ${r.mutationName}`);
        console.log(`         ${r.detectionReason}`);
      }
      console.log(`\nMutation Score: ${res.killedMutants} / ${res.totalMutants} mutants killed (${((res.killedMutants / res.totalMutants) * 100).toFixed(1)}%).`);
      break;
    }

    case 'canonical': {
      console.log('\nExhaustive 2,598,960 Hand Canonical Reduction Check...');
      const start = performance.now();
      const seen = new Set<number>();
      let total = 0;

      for (let i = 0; i < 48; i++) {
        for (let j = i + 1; j < 49; j++) {
          for (let k = j + 1; k < 50; k++) {
            for (let m = k + 1; m < 51; m++) {
              for (let n = m + 1; n < 52; n++) {
                total++;
                const key = getCanonicalHandKey(i, j, k, m, n);
                seen.add(key);
              }
            }
          }
        }
      }
      const elapsed = (performance.now() - start) / 1000;
      console.log(`  Total Hands Evaluated:        ${total.toLocaleString()}`);
      console.log(`  Canonical Equivalence Classes: ${seen.size.toLocaleString()}`);
      console.log(`  Target Canonical Classes:     134,459`);
      console.log(`  Mathematical Verification:    ${seen.size === 134459 ? 'VERIFIED EXACT' : 'MISMATCH'}`);
      console.log(`  Execution Time:               ${elapsed.toFixed(2)} seconds`);
      break;
    }

    case 'simulate': {
      const rounds = parseInt(args[1] || '1000', 10);
      console.log(`\nSimulating ${rounds.toLocaleString()} Rounds of 9/6 Full-Pay Jacks or Better under Optimal Play...`);
      const sim = new VideoPokerSimulator();
      const start = performance.now();
      const res = sim.runSimulation(rounds);
      const elapsed = (performance.now() - start) / 1000;

      console.log(`\nSimulation Completed in ${elapsed.toFixed(2)}s:`);
      console.log(`  Rounds:               ${res.rounds.toLocaleString()}`);
      console.log(`  Mean RTP:             ${(res.meanRTP * 100).toFixed(4)}% (Theoretical: ${(res.theoreticalRTP * 100).toFixed(4)}%)`);
      console.log(`  Sample Variance:      ${res.sampleVariance.toFixed(4)} (Theoretical: ${res.theoreticalVariance.toFixed(4)})`);
      console.log(`  Standard Deviation:   ${res.standardDeviation.toFixed(4)}`);
      console.log(`  Standard Error:       +/- ${(res.standardError * 100).toFixed(4)}%`);
      console.log(`\nCategory Outcomes:`);
      for (const [cat, count] of Object.entries(res.categoryCounts)) {
        const pct = (count / rounds) * 100;
        console.log(`  ${cat.padEnd(18)}: ${count.toString().padStart(6)} (${pct.toFixed(2)}%)`);
      }
      break;
    }

    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
