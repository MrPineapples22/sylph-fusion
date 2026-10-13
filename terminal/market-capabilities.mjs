const configured = value => typeof value === 'string' && value.trim().length > 0;

/** Describe the capabilities supplied by the endpoints actually configured for this process. */
export function resolveMarketCapabilities(env = {}) {
  const providers = Object.freeze({
    rpc: configured(env.MARKET_RPC_URL),
    rugcheck: configured(env.RUGCHECK_URL),
    dexscreener: configured(env.DEXSCREENER_URL),
    kolscan: configured(env.KOLSCAN_URL),
    pumpportal: configured(env.PUMPPORTAL_WS_URL),
  });
  return Object.freeze({
    providers,
    hub: Object.values(providers).some(Boolean),
    discovery: providers.dexscreener || providers.pumpportal,
    search: providers.dexscreener,
    risk: providers.rpc && providers.rugcheck,
  });
}
