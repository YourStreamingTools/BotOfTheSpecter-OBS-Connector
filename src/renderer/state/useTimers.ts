import React from 'react';
import { IPC, type TimersSnapshot } from '@shared/ipc';

export function useTimers() {
  const [snap, setSnap] = React.useState<TimersSnapshot>({ timers: [], state: 'idle' });
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before the snapshot so a 'changed' push during the round-trip isn't lost.
    // If a push arrives before the snapshot resolves, ignore the (stale) snapshot so it can't clobber newer state.
    const off = window.api.on(IPC.timersChanged, (s) => {
      pushSeen = true;
      setSnap(s as TimersSnapshot);
    });
    void window.api.timers.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
