const MAX_TICKS = 50000;
export class SessionRecorder {
  constructor(maxTicks = MAX_TICKS) { this.maxTicks = maxTicks; this.ticks = []; this.startedAt = 0; this.recording = false; }
  start(now = Date.now()) { this.recording = true; this.startedAt = now; }
  stop() { this.recording = false; }
  push(asset, now = Date.now()) {
    if (!this.recording || !asset?.id || !Number.isFinite(Number(asset.price))) return false;
    this.ticks.push({ timestamp: now, asset: asset.id, price: Number(asset.price), liquidity: Number.isFinite(Number(asset.liquidity)) ? Number(asset.liquidity) : null, volume1h: Number.isFinite(Number(asset.volume1h)) ? Number(asset.volume1h) : null, change5m: Number.isFinite(Number(asset.change5m)) ? Number(asset.change5m) : null });
    if (this.ticks.length > this.maxTicks) this.ticks.splice(0, this.ticks.length - this.maxTicks);
    return true;
  }
  export() { return { version: 1, startedAt: this.startedAt, endedAt: Date.now(), ticks: this.ticks.slice() }; }
  clear() { this.ticks.length = 0; this.startedAt = 0; }
}
