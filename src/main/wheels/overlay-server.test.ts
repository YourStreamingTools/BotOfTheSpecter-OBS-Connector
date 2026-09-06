// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { startWheelOverlay, type WheelOverlay } from './overlay-server';
import type { WheelsSnapshot } from '@shared/ipc';

const empty: WheelsSnapshot = {
  wheels: [], activeWheelId: null, overlayUrl: null, spinning: false, spin: null, lastWinner: null
};

let overlay: WheelOverlay | undefined;
afterEach(() => { overlay?.close(); overlay = undefined; });

describe('wheel overlay HTTP', () => {
  it('serves the overlay page and JSON state on localhost', async () => {
    overlay = await startWheelOverlay(() => empty, { startPort: 0 });
    expect(overlay.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/wheel$/);
    const page = await fetch(overlay.url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('BotOfTheSpecter Wheel');
    const state = await fetch(overlay.url.replace(/\/wheel$/, '/state'));
    expect(state.status).toBe(200);
    expect(await state.json()).toMatchObject({ wheels: [], spinning: false });
  });
});
