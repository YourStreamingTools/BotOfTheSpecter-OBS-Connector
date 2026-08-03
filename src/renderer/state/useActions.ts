import React from 'react';
import { IPC, type Action, type ActionInput } from '@shared/ipc';

/** Subscribe to the ActionsService list: seeds from window.api.actions.list() on mount, stays in sync via the IPC.actionsChanged push (no optimistic local mutation — callbacks await the IPC round-trip and let the push refresh). */
export function useActions(): {
  actions: Action[];
  create: (input: ActionInput) => Promise<Action>;
  update: (id: string, input: ActionInput) => Promise<Action | null>;
  remove: (id: string) => Promise<boolean>;
} {
  const [actions, setActions] = React.useState<Action[]>([]);

  React.useEffect(() => {
    let alive = true;
    let pushSeen = false;
    // Subscribe before list so a push during the round-trip isn't lost; ignore a stale list after any push.
    const off = window.api.on(IPC.actionsChanged, (list) => {
      pushSeen = true;
      setActions(list as Action[]);
    });
    void window.api.actions.list().then((list) => { if (alive && !pushSeen) setActions(list); });
    return () => { alive = false; off(); };
  }, []);

  const create = React.useCallback((input: ActionInput) => window.api.actions.create(input), []);
  const update = React.useCallback((id: string, input: ActionInput) => window.api.actions.update(id, input), []);
  const remove = React.useCallback((id: string) => window.api.actions.delete(id), []);

  return { actions, create, update, remove };
}
