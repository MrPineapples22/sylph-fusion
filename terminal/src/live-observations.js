import { indicators } from './engine.js';
import { calculateVelocityBps } from './strategy-math.js';

const finite = value => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

/** Convert API observations to strategy inputs without manufacturing missing data. */
export function mapLiveObservations(tokens, histories) {
  return (Array.isArray(tokens) ? tokens : []).flatMap(t => {
    const price = finite(t.price ?? t.priceUsd ?? (t.mcapUsd ? t.mcapUsd / 1e9 : null));
    const at = finite(t.at ?? t.observedAt ?? Date.now());
    const id = t.pair || t.pairAddress || t.mint || t.id;
    if (!id || !(price > 0) || !(at > 0)) return [];
    const history = [...(histories.get(id) || [])];
    const point = {time: at / 1000, value: price};
    if (!history.length || point.time > history.at(-1).time) history.push(point);
    while (history.length > 300) history.shift();
    histories.set(id, history);
    const latest = history.at(-1), previous = history.at(-2);
    const volume1h = finite(t.volume1h), volume5m = finite(t.volume5m);
    // Compare the latest five-minute volume with the hourly average per five minutes.
    const volume = volume1h > 0 && volume5m != null && volume5m >= 0 ? volume5m * 12 / volume1h : null;
    return [{...t, id, mint:t.mint, symbol:t.symbol || '?', name:t.name || t.symbol || 'Token',
      price:latest.value, at, observedAt:at, liquidity:finite(t.liquidity ?? t.liquidityUsd), volume1h, volume5m, volume,
      history, start:history[0].value, color:'#14F195', ...indicators(history),
      previousRsi:history.length > 1 ? indicators(history.slice(0,-1)).rsi : null,
      velocity:previous ? calculateVelocityBps(latest.value,previous.value,(latest.time-previous.time)*1000)/100 : null,
      spike:0}];
  });
}
