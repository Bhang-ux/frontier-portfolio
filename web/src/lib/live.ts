/**
 * Real-time crypto prices over WebSocket (Binance public market-data stream).
 *
 * Stocks only update when the pipeline republishes (GitHub Pages is static),
 * but crypto trades 24/7 and Binance offers a free, keyless, CORS-free stream.
 * We try the market-data-only host first (not geo-restricted), fall back to
 * the main host, reconnect with exponential backoff, and pause while the tab
 * is hidden. Subscribers use React's useSyncExternalStore.
 */
import { useSyncExternalStore } from 'react';

export interface LiveTick {
  price: number;
  open24h: number;
  changePct24h: number;
  ts: number;
}

const STREAMS: Record<string, string> = {
  'BTC-USD': 'btcusdt',
  'ETH-USD': 'ethusdt',
  'SOL-USD': 'solusdt',
  'GOLD-USD': 'paxgusdt',
};
const HOSTS = ['wss://data-stream.binance.vision/stream', 'wss://stream.binance.com:9443/stream'];

type Status = 'idle' | 'connecting' | 'live' | 'offline';
let ticks: Record<string, LiveTick> = {};
let status: Status = 'idle';
const listeners = new Set<() => void>();
let ws: WebSocket | null = null;
let hostIdx = 0;
let attempt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const emit = () => listeners.forEach((l) => l());
const bySymbol = Object.fromEntries(Object.entries(STREAMS).map(([id, s]) => [s.toUpperCase(), id]));

function connect() {
  if (typeof WebSocket === 'undefined' || ws || document.hidden) return;
  status = 'connecting';
  emit();
  const url = `${HOSTS[hostIdx]}?streams=${Object.values(STREAMS)
    .map((s) => `${s}@miniTicker`)
    .join('/')}`;
  try {
    ws = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    attempt = 0;
    status = 'live';
    emit();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string);
      const d = msg.data ?? msg;
      const id = bySymbol[d.s];
      if (!id) return;
      const price = Number(d.c);
      const open = Number(d.o);
      if (!Number.isFinite(price) || price <= 0) return;
      ticks = {
        ...ticks,
        [id]: {
          price,
          open24h: open,
          changePct24h: open > 0 ? price / open - 1 : 0,
          ts: Number(d.E) || Date.now(),
        },
      };
      emit();
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onclose = () => {
    ws = null;
    if (listeners.size) scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect() {
  status = 'offline';
  emit();
  if (timer) clearTimeout(timer);
  attempt++;
  if (attempt % 2 === 0) hostIdx = (hostIdx + 1) % HOSTS.length;
  const delay = Math.min(60_000, 1000 * 2 ** Math.min(attempt, 6)) * (0.5 + Math.random() / 2);
  timer = setTimeout(connect, delay);
}

function disconnect() {
  if (timer) clearTimeout(timer);
  timer = null;
  ws?.close();
  ws = null;
  status = 'idle';
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) disconnect();
    else if (listeners.size) connect();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) disconnect();
  };
}

export function useLiveTicks(): Record<string, LiveTick> {
  return useSyncExternalStore(
    subscribe,
    () => ticks,
    () => ticks,
  );
}

export function useLiveStatus(): Status {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
}

export const LIVE_IDS = Object.keys(STREAMS);
