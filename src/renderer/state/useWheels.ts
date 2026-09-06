import React from 'react';
import { IPC, type WheelsSnapshot } from '@shared/ipc';

const EMPTY: WheelsSnapshot = {
  wheels: [], activeWheelId: null, overlayUrl: null, spinning: false, spin: null, lastWinner: null
};

export function useWheels() {
  const [snap, setSnap] = React.useState<WheelsSnapshot>(EMPTY);
  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    const off = window.api.on(IPC.wheelsChanged, (s) => {
      pushSeen = true;
      setSnap(s as WheelsSnapshot);
    });
    void window.api.wheels.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);
  return snap;
}
