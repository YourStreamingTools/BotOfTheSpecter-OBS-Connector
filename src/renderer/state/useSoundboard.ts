import React from 'react';
import { IPC, type SoundboardSnapshot } from '@shared/ipc';

export function useSoundboard() {
  const [snap, setSnap] = React.useState<SoundboardSnapshot>({ sounds: [], state: 'idle' });
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before requesting the snapshot so a 'changed' push during the round-trip isn't lost.
    // If a push arrives before the snapshot resolves, ignore the (stale) snapshot so it can't clobber newer state.
    const off = window.api.on(IPC.soundboardChanged, (s) => {
      pushSeen = true;
      setSnap(s as SoundboardSnapshot);
    });
    void window.api.soundboard.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
