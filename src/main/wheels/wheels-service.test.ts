// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WheelsService } from './wheels-service';
import type { WheelsPersist } from '@shared/ipc';
import { SPIN_DURATION_MS } from '@shared/wheels';

function fakeStore(initial: { wheels?: unknown } = {}) {
  let data: { wheels?: unknown } = { ...initial };
  return {
    get: vi.fn((k: 'wheels') => data[k]),
    set: vi.fn(async (k: 'wheels', v: WheelsPersist) => { data = { ...data, [k]: v }; }),
    data: () => data
  };
}

const twoSlices = { name: 'Prizes', slices: [{ label: 'Hat' }, { label: 'Shirt' }] };

describe('WheelsService CRUD', () => {
  it('creates a wheel, persists it, and makes it active', async () => {
    const store = fakeStore();
    const svc = new WheelsService({ store });
    const w = await svc.create(twoSlices);
    expect(w.id).toMatch(/^whl_/);
    expect(w.slices).toHaveLength(2);
    expect(w.slices[0].id).toMatch(/^slc_/);
    expect(svc.snapshot().activeWheelId).toBe(w.id);
    expect(store.set).toHaveBeenCalled();
  });

  it('rejects an empty name', async () => {
    const svc = new WheelsService({ store: fakeStore() });
    await expect(svc.create({ name: '  ', slices: [{ label: 'A' }] })).rejects.toThrow(/name/i);
  });

  it('updates name and slices, keeping ids when provided', async () => {
    const svc = new WheelsService({ store: fakeStore() });
    const w = await svc.create(twoSlices);
    const u = await svc.update(w.id, {
      name: 'Merch',
      slices: [
        { id: w.slices[0].id, label: 'Hat' },
        { id: w.slices[1].id, label: 'Mug' },
        { label: 'Sticker' }
      ]
    });
    expect(u?.name).toBe('Merch');
    expect(u?.slices.map((s) => s.label)).toEqual(['Hat', 'Mug', 'Sticker']);
    expect(u?.slices[0].id).toBe(w.slices[0].id);
    expect(u?.slices[2].id).toMatch(/^slc_/);
  });

  it('deletes a wheel and falls back to another as active', async () => {
    const svc = new WheelsService({ store: fakeStore() });
    const a = await svc.create({ name: 'A', slices: [{ label: '1' }, { label: '2' }] });
    const b = await svc.create({ name: 'B', slices: [{ label: '1' }, { label: '2' }] });
    expect(svc.snapshot().activeWheelId).toBe(a.id);
    expect(await svc.delete(a.id)).toBe(true);
    expect(svc.snapshot().activeWheelId).toBe(b.id);
    expect(svc.snapshot().wheels).toHaveLength(1);
  });

  it('setActive switches the current wheel', async () => {
    const svc = new WheelsService({ store: fakeStore() });
    const a = await svc.create({ name: 'A', slices: [{ label: '1' }, { label: '2' }] });
    const b = await svc.create({ name: 'B', slices: [{ label: '1' }, { label: '2' }] });
    expect(await svc.setActive(b.id)).toBe(true);
    expect(svc.snapshot().activeWheelId).toBe(b.id);
    expect(await svc.setActive(a.id)).toBe(true);
    expect(svc.snapshot().activeWheelId).toBe(a.id);
  });

  it('hydrates valid wheels and drops malformed ones', () => {
    const svc = new WheelsService({
      store: fakeStore({
        wheels: {
          items: [
            {
              id: 'whl_ok', name: 'OK', restRotationDeg: 0, createdAt: 't', updatedAt: 't',
              slices: [{ id: 'slc_a', label: 'A', color: '#9B59B6', weight: 1 }]
            },
            { id: '', name: 'bad' },
            'nope'
          ],
          activeWheelId: 'whl_ok',
          lastWinner: null
        }
      })
    });
    expect(svc.snapshot().wheels.map((w) => w.id)).toEqual(['whl_ok']);
    expect(svc.snapshot().activeWheelId).toBe('whl_ok');
  });
});

describe('WheelsService.spin', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refuses to spin with fewer than two options', async () => {
    const svc = new WheelsService({ store: fakeStore() });
    const w = await svc.create({ name: 'One', slices: [{ label: 'Only' }] });
    await expect(svc.spin(w.id)).rejects.toThrow(/2/);
  });

  it('lands on a weighted winner, then records lastWinner after the duration', async () => {
    const svc = new WheelsService({
      store: fakeStore(),
      random: () => 0, // first slice
      epochMs: () => 1_000
    });
    const w = await svc.create(twoSlices);
    const spin = await svc.spin(w.id);
    expect(spin).not.toBeNull();
    expect(spin?.winnerSliceId).toBe(w.slices[0].id);
    expect(svc.snapshot().spinning).toBe(true);
    await vi.advanceTimersByTimeAsync(SPIN_DURATION_MS);
    const snap = svc.snapshot();
    expect(snap.spinning).toBe(false);
    expect(snap.lastWinner?.label).toBe('Hat');
    expect(snap.wheels[0].restRotationDeg).toBe(((spin!.toDeg % 360) + 360) % 360);
  });

  it('ignores a second spin while one is in flight', async () => {
    const svc = new WheelsService({ store: fakeStore(), random: () => 0 });
    const w = await svc.create(twoSlices);
    const first = await svc.spin(w.id);
    const second = await svc.spin(w.id);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('blocks edits to the spinning wheel', async () => {
    const svc = new WheelsService({ store: fakeStore(), random: () => 0 });
    const w = await svc.create(twoSlices);
    await svc.spin(w.id);
    await expect(svc.update(w.id, twoSlices)).rejects.toThrow(/spinning/);
  });
});
