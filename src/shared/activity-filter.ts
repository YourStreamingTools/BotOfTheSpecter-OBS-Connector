import type { LogEntry, LogSource } from './ipc';

/**
 * High-volume websocket events that flood Live Activity if left on.
 * CLOSED_CAPTION fires once per spoken word.
 */
export const DEFAULT_MUTED_EVENTS: readonly string[] = ['CLOSED_CAPTION'];

const EVENT_NAME = /^[A-Z][A-Z0-9_]{2,}$/;

export function parseMutedEvents(raw: unknown): string[] {
  if (raw === undefined) return [...DEFAULT_MUTED_EVENTS];
  if (!Array.isArray(raw)) return [...DEFAULT_MUTED_EVENTS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const k = x.trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function activityEventKey(entry: Pick<LogEntry, 'message' | 'event'>): string | null {
  const named = typeof entry.event === 'string' ? entry.event.trim() : '';
  if (named) return named;
  const m = entry.message.trim();
  return EVENT_NAME.test(m) ? m : null;
}

export function isActivityVisible(
  entry: Pick<LogEntry, 'src' | 'message' | 'event'>,
  activeSrc: ReadonlySet<LogSource>,
  mutedEvents: ReadonlySet<string>
): boolean {
  if (!activeSrc.has(entry.src)) return false;
  const key = activityEventKey(entry);
  if (key && mutedEvents.has(key)) return false;
  return true;
}

/** Default muted names first, then any other event names currently in the log. */
export function collectActivityEvents(entries: Array<Pick<LogEntry, 'message' | 'event'>>): string[] {
  const seen = new Set<string>(DEFAULT_MUTED_EVENTS);
  const out = [...DEFAULT_MUTED_EVENTS];
  for (const e of entries) {
    const k = activityEventKey(e);
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
