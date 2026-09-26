import { z } from 'zod';
const integer = (fallback, min, max) => z.coerce.number().int().min(min).max(max).default(fallback);
const secureUrls = (protocols) => z.string().transform(s => s.split(',').map(x => x.trim())).pipe(z.array(z.string().url().refine(s => protocols.includes(new URL(s).protocol), 'secure URL required')).min(1));
export const schema = z.object({
    MODE: z.enum(['paper', 'live']).default('paper'),
    RPC_URLS: secureUrls(['https:']),
    WS_URLS: secureUrls(['wss:']),
    YELLOWSTONE_URL: z.union([z.literal(''), z.string().url().startsWith('https://')]).default(''),
    YELLOWSTONE_TOKEN: z.string().default(''),
    KEYPAIR_PATH: z.string().default(''),
    DB_PATH: z.string().default('fusion.sqlite'),
    UI_PORT: integer(8787, 1024, 65535),
    BUY_LAMPORTS: integer(10_000_000, 100_000, 10_000_000_000),
    PAPER_CASH_LAMPORTS: integer(1_000_000_000, 100_000_000, 1_000_000_000_000),
    MAX_POSITIONS: integer(3, 1, 20),
    MAX_EXPOSURE_LAMPORTS: integer(100_000_000, 100_000, 100_000_000_000),
    MAX_DAILY_LOSS_LAMPORTS: integer(30_000_000, 1, 100_000_000_000),
    MAX_SPECULATIVE_RISK_BPS: integer(100, 50, 150),
    ROLLING_DRAWDOWN_BPS: integer(500, 100, 2000),
    FAILURE_HALT_COUNT: integer(3, 1, 10),
    FAILURE_WINDOW_MS: integer(3_600_000, 60_000, 86_400_000),
    RESERVE_LAMPORTS: integer(30_000_000, 10_000_000, 100_000_000_000),
    SLIPPAGE_BPS: integer(300, 1, 2000),
    PANIC_SLIPPAGE_BPS: integer(1000, 1, 3000),
    MAX_IMPACT_BPS: integer(500, 1, 3000),
    MAX_FEE_BPS: integer(300, 1, 3000),
    MIN_BUYERS: integer(5, 5, 100),
    MIN_AGE_MS: integer(10_000, 10_000, 300_000),
    MAX_AGE_MS: integer(180_000, 20_000, 3_600_000),
    MIN_CREATOR_LAMPORTS: integer(1_000_000, 0, 100_000_000_000),
    MAX_CREATOR_BPS: integer(500, 0, 10_000),
    MAX_TOP_TEN_BPS: integer(3000, 1, 10_000),
    MIN_REAL_RESERVE_LAMPORTS: integer(1_000_000_000, 1, 100_000_000_000),
    LIQUIDITY_DROP_BPS: integer(2500, 500, 9000),
    STOP_BPS: integer(1200, 100, 5000),
    FEED_STALE_MS: integer(10_000, 2000, 120_000),
    QUOTE_MAX_AGE_MS: integer(3000, 250, 10_000),
    RPC_TIMEOUT_MS: integer(4000, 250, 30_000),
    POLL_MS: integer(1000, 250, 30_000),
    MAX_TRACKED: integer(500, 20, 5000),
    MAX_QUEUE: integer(32, 1, 256),
    MAX_TIP_LAMPORTS: integer(500_000, 1000, 10_000_000),
    MIN_TIP_LAMPORTS: integer(10_000, 1000, 10_000_000),
    MAX_PRIORITY_LAMPORTS: integer(200_000, 1000, 10_000_000),
    JITO_URL: z.string().url().startsWith('https://').default('https://mainnet.block-engine.jito.wtf/api/v1/bundles'),
    JITO_AUTH: z.string().default(''),
    RUGCHECK_URL: z.string().url().startsWith('https://').default('https://api.rugcheck.xyz/v1/tokens'),
    RUGCHECK_MAX_SCORE: integer(1000, 0, 100_000),
    JUPITER_API_KEY: z.string().default(''),
    JUPITER_URL: z.string().url().startsWith('https://').default('https://api.jup.ag/swap/v1'),
    SESSION_DIR: z.string().default(''),
    CHECKPOINT_INTERVAL_MS: integer(3_600_000, 10_000, 86_400_000),
}).superRefine((c, ctx) => {
    const fail = (message) => ctx.addIssue({ code: 'custom', message });
    if (c.MODE === 'live' && !c.KEYPAIR_PATH)
        fail('live mode requires KEYPAIR_PATH');
    if (c.MODE === 'live' && new Set(c.RPC_URLS).size < 2)
        fail('live mode requires two distinct RPC URLs');
    if (c.MIN_TIP_LAMPORTS > c.MAX_TIP_LAMPORTS)
        fail('tip minimum exceeds maximum');
    if (c.MIN_AGE_MS >= c.MAX_AGE_MS)
        fail('invalid age window');
    if (c.BUY_LAMPORTS > c.MAX_EXPOSURE_LAMPORTS)
        fail('buy exceeds exposure cap');
    if (c.PANIC_SLIPPAGE_BPS < c.SLIPPAGE_BPS)
        fail('panic slippage must be at least normal slippage');
});
export function config(env = process.env) { return schema.parse(env); }
//# sourceMappingURL=config.js.map