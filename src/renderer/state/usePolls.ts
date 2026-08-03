import React from 'react';
import { IPC, type PollsSnapshot } from '@shared/ipc';

export function usePolls() {
  const [snap, setSnap] = React.useState<PollsSnapshot>({ polls: [], state: 'idle' });
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before the snapshot so a 'changed' push during the round-trip isn't lost.
    // If a push arrives before the snapshot resolves, ignore the (stale) snapshot so it can't clobber newer state.
    const off = window.api.on(IPC.pollsChanged, (s) => {
      pushSeen = true;
      setSnap(s as PollsSnapshot);
    });
    void window.api.polls.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
