import React from 'react';
import { IPC, type CommandsSnapshot } from '@shared/ipc';

const EMPTY: CommandsSnapshot = { builtin: [], custom: [], user: [], state: 'idle' };

/** Subscribe to the CommandsService snapshot: seeds from the current snapshot on mount and updates on the 'changed' push when refresh completes. */
export function useCommands(): { snap: CommandsSnapshot; refresh: () => Promise<void> } {
  const [snap, setSnap] = React.useState<CommandsSnapshot>(EMPTY);

  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before the snapshot so a push during the round-trip isn't lost, and ignore a stale snapshot after any push.
    const off = window.api.on(IPC.commandsChanged, (s) => {
      pushSeen = true;
      setSnap(s as CommandsSnapshot);
    });
    void window.api.commands.snapshot().then((s) => { if (alive && !pushSeen) setSnap(s); });
    return () => { alive = false; off(); };
  }, []);

  const refresh = React.useCallback(() => window.api.commands.refresh(), []);
  return { snap, refresh };
}
