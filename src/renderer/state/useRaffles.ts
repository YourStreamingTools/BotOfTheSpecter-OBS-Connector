import React from 'react';
import { IPC, type RafflesSnapshot } from '@shared/ipc';

export function useRaffles() {
  const [snap, setSnap] = React.useState<RafflesSnapshot>({ raffles: [], state: 'idle' });
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before the snapshot so a 'changed' push during the round-trip isn't lost.
    // If a push arrives before the snapshot resolves, ignore the (stale) snapshot so it can't clobber newer state.
    const off = window.api.on(IPC.rafflesChanged, (s) => {
      pushSeen = true;
      setSnap(s as RafflesSnapshot);
    });
    void window.api.raffles.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
