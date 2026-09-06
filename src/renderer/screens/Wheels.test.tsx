import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ScreenWheels } from './Wheels';
import type { Wheel, WheelsSnapshot } from '@shared/ipc';

let listeners: Record<string, (...a: unknown[]) => void>;

const wheel = (over: Partial<Wheel> = {}): Wheel => ({
  id: 'whl_a',
  name: 'Prizes',
  restRotationDeg: 0,
  createdAt: 't',
  updatedAt: 't',
  slices: [
    { id: 'slc_1', label: 'Hat', color: '#9B59B6', weight: 1 },
    { id: 'slc_2', label: 'Shirt', color: '#1ABC9C', weight: 1 }
  ],
  ...over
});

const setSnapshot = (snap: WheelsSnapshot) => {
  window.api.wheels = {
    snapshot: vi.fn().mockResolvedValue(snap),
    create: vi.fn().mockResolvedValue(wheel({ id: 'whl_new', name: 'Wheel 1' })),
    update: vi.fn().mockResolvedValue(snap.wheels[0] ?? null),
    delete: vi.fn().mockResolvedValue(true),
    setActive: vi.fn().mockResolvedValue(true),
    spin: vi.fn().mockResolvedValue(null),
    openOverlay: vi.fn().mockResolvedValue(snap.overlayUrl)
  };
};

beforeEach(() => {
  listeners = {};
  window.api.on = vi.fn((c: string, cb: (...a: unknown[]) => void) => {
    listeners[c] = cb;
    return () => delete listeners[c];
  });
  setSnapshot({
    wheels: [], activeWheelId: null, overlayUrl: null, spinning: false, spin: null, lastWinner: null
  });
});

describe('ScreenWheels', () => {
  it('prompts to create a wheel when none exist', async () => {
    render(<ScreenWheels />);
    expect(await screen.findByText(/No wheels yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /new wheel/i })[0]);
    expect(window.api.wheels.create).toHaveBeenCalled();
  });

  it('lists wheels and switches the active one', async () => {
    const a = wheel({ id: 'whl_a', name: 'Prizes' });
    const b = wheel({ id: 'whl_b', name: 'Games' });
    setSnapshot({
      wheels: [a, b], activeWheelId: 'whl_a', overlayUrl: 'http://127.0.0.1:47821/wheel',
      spinning: false, spin: null, lastWinner: null
    });
    render(<ScreenWheels />);
    expect((await screen.findAllByText('Prizes')).length).toBeGreaterThan(0);
    expect(screen.getByText('Games')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /games/i }));
    expect(window.api.wheels.setActive).toHaveBeenCalledWith('whl_b');
  });

  it('spins the active wheel', async () => {
    const a = wheel();
    setSnapshot({
      wheels: [a], activeWheelId: a.id, overlayUrl: null,
      spinning: false, spin: null, lastWinner: null
    });
    render(<ScreenWheels />);
    const spin = await screen.findByRole('button', { name: /^spin$/i });
    await act(async () => { fireEvent.click(spin); });
    expect(window.api.wheels.spin).toHaveBeenCalledWith(a.id);
  });
});
