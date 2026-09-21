import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  FastForward,
  Clock,
  Database,
  Search,
  Filter,
  Layers,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  TrendingUp,
  Wallet,
  Zap,
  Activity
} from 'lucide-react';

export function SessionReplayViewer({ currentSession = '', availableSessions = [] }) {
  const [sessionName, setSessionName] = useState(currentSession);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Playhead state
  const [cursor, setCursor] = useState(0); // event index
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // 1x, 2x, 5x
  const [searchFilter, setSearchFilter] = useState('');
  const playTimerRef = useRef(null);

  // Update session selection when prop changes
  useEffect(() => {
    if (currentSession && !sessionName) {
      setSessionName(currentSession);
    }
  }, [currentSession]);

  // Fetch events for selected session
  useEffect(() => {
    if (!sessionName) return;
    const fetchEvents = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/soak/events?session=${encodeURIComponent(sessionName)}&limit=1000`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setEvents(data.events || []);
        setCursor(0);
        setIsPlaying(false);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [sessionName]);

  // Playback timer
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(80, Math.floor(600 / playbackSpeed));
      playTimerRef.current = setInterval(() => {
        setCursor(prev => {
          if (prev >= events.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, events.length]);

  // Reconstructed state at current cursor
  const reconstructed = useMemo(() => {
    if (!events.length) {
      return {
        candidatesConsidered: 0,
        rejectionsCount: 0,
        fillsCount: 0,
        blockedExitsCount: 0,
        clearedExitsCount: 0,
        realizedPnlLamports: 0n,
        activeExitBlock: null,
        lastCheckpoint: null,
        recentRejections: [],
        openPositions: {},
      };
    }

    const slice = events.slice(0, cursor + 1);
    let rejectionsCount = 0;
    let fillsCount = 0;
    let blockedExitsCount = 0;
    let clearedExitsCount = 0;
    let realizedPnlLamports = 0n;
    let activeExitBlock = null;
    let lastCheckpoint = null;
    const rejections = [];
    const openPositions = {};

    for (const evt of slice) {
      if (evt.event === 'entry_rejected') {
        rejectionsCount++;
        rejections.unshift({
          mint: evt.mint,
          reason: evt.reason,
          time: evt.time,
          curve: evt.curve,
          drift: evt.drift,
        });
      } else if (evt.event === 'exit_blocked_by_pending') {
        blockedExitsCount++;
        activeExitBlock = {
          mint: evt.mint,
          reason: evt.reason,
          pendingMint: evt.pendingMint,
          stage: evt.stage,
          blockedAt: evt.time,
        };
      } else if (evt.event === 'exit_block_cleared') {
        clearedExitsCount++;
        if (activeExitBlock && activeExitBlock.mint === evt.mint) {
          activeExitBlock = null;
        }
      } else if (evt.event === 'soak_checkpoint') {
        lastCheckpoint = evt;
      } else if (evt.event === 'fill_finalized' || evt.event === 'paper_fill') {
        fillsCount++;
        if (evt.side === 'sell' && evt.netLamports) {
          realizedPnlLamports += BigInt(evt.netLamports);
        }
      }
    }

    return {
      candidatesConsidered: rejectionsCount + fillsCount,
      rejectionsCount,
      fillsCount,
      blockedExitsCount,
      clearedExitsCount,
      realizedPnlLamports: realizedPnlLamports.toString(),
      activeExitBlock,
      lastCheckpoint,
      recentRejections: rejections.slice(0, 15),
    };
  }, [events, cursor]);

  const currentEvent = events[cursor] || null;
  const progressPct = events.length > 1 ? ((cursor / (events.length - 1)) * 100).toFixed(1) : 0;

  const filteredEvents = useMemo(() => {
    if (!searchFilter.trim()) return events;
    const q = searchFilter.toLowerCase();
    return events.filter(e =>
      (e.event && e.event.toLowerCase().includes(q)) ||
      (e.mint && e.mint.toLowerCase().includes(q)) ||
      (e.reason && e.reason.toLowerCase().includes(q))
    );
  }, [events, searchFilter]);

  return (
    <article className="soak-card replay-viewer-card" id="session-replay-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">HISTORICAL FORENSICS & TIME TRAVEL</span>
          <h3>Session Replay Viewer</h3>
        </div>
        <div className="replay-header-session">
          <label htmlFor="replay-session-select">SESSION:</label>
          <select
            id="replay-session-select"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            className="session-select font-mono"
          >
            {availableSessions.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Scrubber & Playback Controls Bar */}
      <div className="replay-controls-bar">
        <div className="playback-buttons">
          <button
            className="control-btn"
            title="Reset to beginning"
            onClick={() => { setCursor(0); setIsPlaying(false); }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="control-btn"
            title="Step back 1 event"
            disabled={cursor <= 0}
            onClick={() => { setCursor(c => Math.max(0, c - 1)); setIsPlaying(false); }}
          >
            <SkipBack size={13} />
          </button>
          <button
            className="control-btn play-btn"
            title={isPlaying ? 'Pause' : 'Play timeline'}
            onClick={() => setIsPlaying(!isPlaying)}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            className="control-btn"
            title="Step forward 1 event"
            disabled={cursor >= events.length - 1}
            onClick={() => { setCursor(c => Math.min(events.length - 1, c + 1)); }}
          >
            <SkipForward size={13} />
          </button>
        </div>

        {/* Speed Toggle */}
        <div className="speed-toggles">
          {[1, 2, 5].map(speed => (
            <button
              key={speed}
              className={`speed-btn font-mono ${playbackSpeed === speed ? 'active' : ''}`}
              onClick={() => setPlaybackSpeed(speed)}
            >
              {speed}x
            </button>
          ))}
        </div>

        {/* Scrubber Slider */}
        <div className="scrubber-track-wrap">
          <input
            type="range"
            min={0}
            max={Math.max(0, events.length - 1)}
            value={cursor}
            onChange={(e) => setCursor(Number(e.target.value))}
            className="replay-slider"
            aria-label="Timeline scrubber"
          />
          <div className="scrubber-labels font-mono">
            <span>Event {events.length ? cursor + 1 : 0} of {events.length}</span>
            <span>{progressPct}% ({currentEvent?.time ? new Date(currentEvent.time).toLocaleTimeString('en-US', { hour12: false }) : '00:00:00'})</span>
          </div>
        </div>
      </div>

      {/* Exit Blocking Banner if Active at Cursor */}
      {reconstructed.activeExitBlock && (
        <div className="replay-blocking-alert" role="region" aria-label="Exit blocked state">
          <ShieldAlert size={16} />
          <div>
            <b>EXIT BLOCKED BY IN-FLIGHT ORDER AT THIS TIMESTEP</b>
            <p>
              Position <span className="font-mono">{reconstructed.activeExitBlock.mint.slice(0, 8)}…</span> triggered exit ({reconstructed.activeExitBlock.reason}) but execution is waiting for in-flight pending order <span className="font-mono">{reconstructed.activeExitBlock.pendingMint?.slice(0, 8)}…</span>.
            </p>
          </div>
        </div>
      )}

      {/* State Reconstruction Grid at Playhead */}
      <div className="replay-state-grid">
        <div className="replay-metric-tile">
          <small>CANDIDATES EVALUATED</small>
          <b className="font-mono">{reconstructed.candidatesConsidered}</b>
          <span>{reconstructed.rejectionsCount} rejected · {reconstructed.fillsCount} filled</span>
        </div>

        <div className="replay-metric-tile">
          <small>PENDING ORDER BLOCKING</small>
          <b className={`font-mono ${reconstructed.blockedExitsCount > 0 ? 'text-warn' : 'text-good'}`}>
            {reconstructed.blockedExitsCount} Blocked
          </b>
          <span>{reconstructed.clearedExitsCount} cleared without loss</span>
        </div>

        <div className="replay-metric-tile">
          <small>CHECKPOINT UPTIME</small>
          <b className="font-mono">{reconstructed.lastCheckpoint?.uptimeHours ?? 0}h</b>
          <span>Feed: {reconstructed.lastCheckpoint?.feedHealthy ? 'HEALTHY' : 'STANDBY'}</span>
        </div>

        <div className="replay-metric-tile">
          <small>REALIZED SESSION P&amp;L</small>
          <b className="font-mono">
            {reconstructed.lastCheckpoint?.realizedPnl ?? (Number(reconstructed.realizedPnlLamports) / 1e9).toFixed(4)} SOL
          </b>
          <span>Cash: {reconstructed.lastCheckpoint ? (Number(reconstructed.lastCheckpoint.cash) / 1e9).toFixed(2) : '1.00'} SOL</span>
        </div>
      </div>

      {/* Forensic Inspection Splits: Current Event & Gate Rejection Stream */}
      <div className="replay-splits-row">
        {/* Left: Current Event Inspector */}
        <div className="replay-inspector-panel">
          <div className="panel-subhead">
            <Activity size={13} />
            <span>PLAYHEAD EVENT #{cursor + 1}</span>
          </div>

          {currentEvent ? (
            <div className="current-event-card">
              <div className="event-meta-row font-mono">
                <span className={`event-tag tag-${currentEvent.event}`}>{currentEvent.event}</span>
                <span className="event-time">{new Date(currentEvent.time).toISOString()}</span>
              </div>
              {currentEvent.mint && (
                <div className="event-field font-mono">
                  <small>MINT:</small> <b>{currentEvent.mint}</b>
                </div>
              )}
              {currentEvent.reason && (
                <div className="event-field">
                  <small>GATE REASON:</small> <span className="text-warn">{currentEvent.reason}</span>
                </div>
              )}
              {currentEvent.drift && (
                <div className="event-drift-box font-mono">
                  <small>DRIFT RECORD AT REJECTION:</small>
                  <div>Price drift: {currentEvent.drift.priceDriftBps} BPS | Liquidity drop: {currentEvent.drift.liquidityDropBps} BPS</div>
                </div>
              )}
            </div>
          ) : (
            <div className="empty-substate">
              <span>No event at cursor.</span>
            </div>
          )}
        </div>

        {/* Right: Chronological Gate Decisions List with Click-to-Seek */}
        <div className="replay-events-stream">
          <div className="panel-subhead">
            <Filter size={13} />
            <span>GATE DECISIONS TAPE (CLICK TO SEEK)</span>
            <input
              type="text"
              placeholder="Filter mint or reason…"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="replay-search-input"
            />
          </div>

          <div className="events-stream-list">
            {filteredEvents.slice(0, 50).map((evt, idx) => {
              const originalIndex = events.indexOf(evt);
              const isActive = originalIndex === cursor;
              return (
                <div
                  key={evt.id ?? idx}
                  className={`stream-event-item ${isActive ? 'stream-active' : ''}`}
                  onClick={() => { setCursor(originalIndex); setIsPlaying(false); }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="stream-left">
                    <span className={`stream-dot dot-${evt.event}`} />
                    <b className="font-mono text-xs">{evt.event}</b>
                    {evt.mint && <span className="stream-mint font-mono">{evt.mint.slice(0, 4)}…{evt.mint.slice(-4)}</span>}
                    {evt.reason && <span className="stream-reason">{evt.reason}</span>}
                  </div>
                  <time className="font-mono text-xs text-muted">
                    {evt.time ? new Date(evt.time).toLocaleTimeString('en-US', { hour12: false }) : ''}
                  </time>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="soak-card-footer">
        <small>
          Deterministic playback: Historical session event stream loaded from immutable local artifacts (`session.jsonl` & `fills.csv`).
        </small>
      </div>
    </article>
  );
}

export default SessionReplayViewer;
