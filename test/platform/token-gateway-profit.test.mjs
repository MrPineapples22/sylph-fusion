import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TokenAdmissionGateway } from '../../dist/platform/security/token-gateway.js';

describe('ELITE UPDATE 6: Token Security Gateway Liquidity Fracture Cap & Dispersion Alpha', () => {
  it('1. Enforces dynamic liquidity fracture cap (10% of reserve) during LIMIT verdict', () => {
    const gateway = new TokenAdmissionGateway();

    // Shallow bonding pool: 1.5 SOL real reserve (1_500_000_000n)
    // Score lands in LIMIT range (20-44) due to unrevoked mint authority (+30)
    const shallowResult = gateway.evaluate({
      mint: 'MintShallow1111111111111111111111111111111',
      creator: 'Creator1111111111111111111111111111111111',
      rugcheckScore: 100,
      rugged: false,
      isMintAuthorityRevoked: false, // +30 score -> LIMIT
      isFreezeAuthorityRevoked: true,
      token2022TransferFeeBps: null,
      hasPermanentDelegate: false,
      top10HoldersBps: 2000,
      realQuoteReserveLamports: 1_500_000_000n, // 1.5 SOL
      creatorTokensHeldPct: 2.0,
      knownIncidentHistoryCount: 0,
    });

    assert.equal(shallowResult.verdict, 'LIMIT');
    // 10% of 1.5 SOL is 150_000_000n (0.15 SOL), which is smaller than 0.5 SOL base limit
    assert.equal(shallowResult.allowedMaxPositionSizeLamports, 150_000_000n);
    assert.ok(shallowResult.allowedMaxPositionSizeLamports < 500_000_000n);

    // Deep bonding pool: 10 SOL real reserve (10_000_000_000n)
    const deepResult = gateway.evaluate({
      mint: 'MintDeep11111111111111111111111111111111111',
      creator: 'Creator1111111111111111111111111111111111',
      rugcheckScore: 100,
      rugged: false,
      isMintAuthorityRevoked: false, // +30 score -> LIMIT
      isFreezeAuthorityRevoked: true,
      token2022TransferFeeBps: null,
      hasPermanentDelegate: false,
      top10HoldersBps: 2000,
      realQuoteReserveLamports: 10_000_000_000n, // 10 SOL
      creatorTokensHeldPct: 2.0,
      knownIncidentHistoryCount: 0,
    });

    assert.equal(deepResult.verdict, 'LIMIT');
    // 10% of 10 SOL is 1 SOL, but capped at 0.5 SOL (500_000_000n) ceiling
    assert.equal(deepResult.allowedMaxPositionSizeLamports, 500_000_000n);
  });

  it('2. Awards organic holder dispersion alpha discount for decentralized holder distributions', () => {
    const gateway = new TokenAdmissionGateway();

    // Decentralized holder distribution: top 10 hold 12% (1200 bps), creator holds 1.5%
    // Rugcheck score 600 normally adds +20 score (LIMIT).
    // With organic dispersion discount (-15), score drops to 5, elevating verdict to ALLOW!
    const result = gateway.evaluate({
      mint: 'MintOrganic1111111111111111111111111111111',
      creator: 'Creator1111111111111111111111111111111111',
      rugcheckScore: 600, // +20
      rugged: false,
      isMintAuthorityRevoked: true,
      isFreezeAuthorityRevoked: true,
      token2022TransferFeeBps: null,
      hasPermanentDelegate: false,
      top10HoldersBps: 1200, // Highly decentralized!
      realQuoteReserveLamports: 5_000_000_000n,
      creatorTokensHeldPct: 1.5,
      knownIncidentHistoryCount: 0,
    });

    assert.ok(result.flags.includes('organic_holder_dispersion'));
    assert.equal(result.riskScore, 5); // 20 - 15 = 5
    assert.equal(result.verdict, 'ALLOW');
    assert.equal(result.allowedMaxPositionSizeLamports, null); // Full mandate capacity unlocked
  });
});
