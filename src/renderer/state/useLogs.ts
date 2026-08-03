import React from 'react';
import { IPC, type LogEntry } from '@shared/ipc';

const CAP = 500;

function logKey(e: LogEntry): string {
  return `${e.t}|${e.src}|${e.level}|${e.message}`;
}

export function useLogs() {
  const [lines, setLines] = React.useState<LogEntry[]>([]);
  React.useEffect(() => {
    let alive = true;
    // Subscribe BEFORE the snapshot so a line emitted during the round-trip isn't lost.
    const off = window.api.on(IPC.logLine, (e) => setLines((prev) => [e as LogEntry, ...prev].slice(0, CAP)));
    void window.api.logs.snapshot().then((s) => {
      if (!alive) return;
      // Newest-first: keep live lines from the round-trip, then snapshot history without duplicating keys.
      setLines((live) => {
        const seen = new Set(live.map(logKey));
        const history = s.filter((e) => !seen.has(logKey(e)));
        return [...live, ...history].slice(0, CAP);
      });
    });
    return () => { alive = false; off(); };
  }, []);
  return lines;
}
