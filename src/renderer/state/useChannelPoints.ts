import React from 'react';
import { IPC, type ChannelPointsSnapshot } from '@shared/ipc';

export function useChannelPoints(): ChannelPointsSnapshot {
  const [snap, setSnap] = React.useState<ChannelPointsSnapshot>({ rewards: [], state: 'idle' });
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before the snapshot so a 'changed' push during the round-trip isn't lost.
    // If a push arrives before the snapshot resolves, ignore the (stale) snapshot so it can't clobber newer state.
    const off = window.api.on(IPC.channelPointsChanged, (s) => {
      pushSeen = true;
      setSnap(s as ChannelPointsSnapshot);
    });
    void window.api.channelPoints.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
