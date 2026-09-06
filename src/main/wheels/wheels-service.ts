import { EventEmitter } from 'events';
import type {
  Wheel, WheelInput, WheelSlice, WheelSpin, WheelWinner, WheelsPersist, WheelsSnapshot
} from '@shared/ipc';
import {
  extraTurns, layoutSlices, pickWeightedIndex, sliceColor, spinTargetDeg,
  spinnableSlices, validateWheelInput, MIN_SLICES_TO_SPIN, SPIN_DURATION_MS
} from '@shared/wheels';

export interface WheelsStore {
  get(key: 'wheels'): unknown;
  set(key: 'wheels', value: WheelsPersist): void | Promise<void>;
}

export interface WheelsServiceDeps {
  store: WheelsStore;
  now?: () => string;
  random?: () => number;
  epochMs?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Local spinning-wheel store: many named wheels, one active, weighted spin, overlay URL attached by the HTTP helper. */
export class WheelsService extends EventEmitter {
  private readonly store: WheelsStore;
  private readonly now: () => string;
  private readonly random: () => number;
  private readonly epochMs: () => number;
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private wheels: Wheel[] = [];
  private activeWheelId: string | null = null;
  private overlayUrl: string | null = null;
  private spinning = false;
  private currentSpin: WheelSpin | null = null;
  private lastWinner: WheelWinner | null = null;
  private spinTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(deps: WheelsServiceDeps) {
    super();
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.random = deps.random ?? Math.random;
    this.epochMs = deps.epochMs ?? (() => Date.now());
    this.setTimeoutFn = deps.setTimeout ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeout ?? clearTimeout;
    const persist = hydratePersist(this.store.get('wheels'));
    this.wheels = persist.items;
    this.activeWheelId = persist.activeWheelId && this.wheels.some((w) => w.id === persist.activeWheelId)
      ? persist.activeWheelId
      : (this.wheels[0]?.id ?? null);
    this.lastWinner = persist.lastWinner;
  }

  snapshot(): WheelsSnapshot {
    return {
      wheels: this.wheels.map(cloneWheel),
      activeWheelId: this.activeWheelId,
      overlayUrl: this.overlayUrl,
      spinning: this.spinning,
      spin: this.currentSpin ? { ...this.currentSpin } : null,
      lastWinner: this.lastWinner ? { ...this.lastWinner } : null
    };
  }

  setOverlayUrl(url: string | null): void {
    this.overlayUrl = url;
    this.emit('changed', this.snapshot());
  }

  async create(input: WheelInput): Promise<Wheel> {
    const err = validateWheelInput(input);
    if (err) throw new Error(err);
    const ts = this.now();
    const wheel: Wheel = {
      id: this.freshId('whl_'),
      name: input.name.trim(),
      slices: this.normaliseSlices(input.slices),
      restRotationDeg: 0,
      createdAt: ts,
      updatedAt: ts
    };
    this.wheels = [...this.wheels, wheel];
    if (!this.activeWheelId) this.activeWheelId = wheel.id;
    await this.persist();
    return cloneWheel(wheel);
  }

  async update(id: string, input: WheelInput): Promise<Wheel | null> {
    const err = validateWheelInput(input);
    if (err) throw new Error(err);
    const idx = this.wheels.findIndex((w) => w.id === id);
    if (idx < 0) return null;
    if (this.spinning && this.currentSpin?.wheelId === id) {
      throw new Error('Cannot edit a wheel while it is spinning');
    }
    const existing = this.wheels[idx];
    const updated: Wheel = {
      ...existing,
      name: input.name.trim(),
      slices: this.normaliseSlices(input.slices, existing.slices),
      updatedAt: this.now()
    };
    const next = [...this.wheels];
    next[idx] = updated;
    this.wheels = next;
    await this.persist();
    return cloneWheel(updated);
  }

  async delete(id: string): Promise<boolean> {
    const idx = this.wheels.findIndex((w) => w.id === id);
    if (idx < 0) return false;
    if (this.spinning && this.currentSpin?.wheelId === id) {
      throw new Error('Cannot delete a wheel while it is spinning');
    }
    this.wheels = this.wheels.filter((w) => w.id !== id);
    if (this.activeWheelId === id) this.activeWheelId = this.wheels[0]?.id ?? null;
    if (this.lastWinner?.wheelId === id) this.lastWinner = null;
    await this.persist();
    return true;
  }

  async setActive(id: string): Promise<boolean> {
    if (!this.wheels.some((w) => w.id === id)) return false;
    if (this.activeWheelId === id) return true;
    this.activeWheelId = id;
    await this.persist();
    return true;
  }

  async spin(id?: string): Promise<WheelSpin | null> {
    if (this.spinning) return null;
    const wheelId = id ?? this.activeWheelId;
    const wheel = this.wheels.find((w) => w.id === wheelId);
    if (!wheel) return null;
    const usable = spinnableSlices(wheel.slices);
    if (usable.length < MIN_SLICES_TO_SPIN) {
      throw new Error(`Add at least ${MIN_SLICES_TO_SPIN} options before spinning`);
    }
    const winnerIdx = pickWeightedIndex(usable, this.random);
    if (winnerIdx < 0) return null;
    const layout = layoutSlices(usable);
    const winner = layout[winnerIdx];
    const fromDeg = wheel.restRotationDeg;
    const toDeg = spinTargetDeg(winner.midDeg, fromDeg, extraTurns(this.random));
    const spin: WheelSpin = {
      wheelId: wheel.id,
      winnerSliceId: winner.id,
      fromDeg,
      toDeg,
      startedAt: this.epochMs(),
      durationMs: SPIN_DURATION_MS
    };
    this.spinning = true;
    this.currentSpin = spin;
    this.activeWheelId = wheel.id;
    this.emit('changed', this.snapshot());
    this.spinTimer = this.setTimeoutFn(() => { void this.finishSpin(); }, SPIN_DURATION_MS);
    return { ...spin };
  }

  dispose(): void {
    if (this.spinTimer !== undefined) this.clearTimeoutFn(this.spinTimer);
    this.spinTimer = undefined;
  }

  private async finishSpin(): Promise<void> {
    this.spinTimer = undefined;
    const spin = this.currentSpin;
    if (!spin) return;
    const idx = this.wheels.findIndex((w) => w.id === spin.wheelId);
    if (idx >= 0) {
      const wheel = this.wheels[idx];
      const rest = ((spin.toDeg % 360) + 360) % 360;
      const winnerSlice = wheel.slices.find((s) => s.id === spin.winnerSliceId);
      const next = [...this.wheels];
      next[idx] = { ...wheel, restRotationDeg: rest, updatedAt: this.now() };
      this.wheels = next;
      this.lastWinner = winnerSlice
        ? { wheelId: wheel.id, sliceId: winnerSlice.id, label: winnerSlice.label, at: this.now() }
        : this.lastWinner;
    }
    this.spinning = false;
    await this.persist();
  }

  private normaliseSlices(
    input: WheelInput['slices'],
    previous: WheelSlice[] = []
  ): WheelSlice[] {
    const prevById = new Map(previous.map((s) => [s.id, s]));
    return input.map((raw, i) => {
      const keep = raw.id ? prevById.get(raw.id) : undefined;
      const id = keep?.id ?? this.freshId('slc_');
      const weight = typeof raw.weight === 'number' && raw.weight > 0 ? raw.weight : 1;
      return {
        id,
        label: raw.label.trim(),
        color: sliceColor(i, raw.color || keep?.color),
        weight
      };
    });
  }

  private freshId(prefix: string): string {
    const taken = new Set([
      ...this.wheels.map((w) => w.id),
      ...this.wheels.flatMap((w) => w.slices.map((s) => s.id))
    ]);
    let id = genId(prefix);
    while (taken.has(id)) id = genId(prefix);
    return id;
  }

  private async persist(): Promise<void> {
    await this.store.set('wheels', {
      items: this.wheels,
      activeWheelId: this.activeWheelId,
      lastWinner: this.lastWinner
    });
    this.emit('changed', this.snapshot());
  }
}

function cloneWheel(w: Wheel): Wheel {
  return { ...w, slices: w.slices.map((s) => ({ ...s })) };
}

function genId(prefix: string): string {
  let s = prefix;
  for (let i = 0; i < 10; i++) s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return s;
}

function hydratePersist(raw: unknown): WheelsPersist {
  if (!raw || typeof raw !== 'object') return { items: [], activeWheelId: null, lastWinner: null };
  const obj = raw as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? obj.items.filter(isValidWheel) : [];
  const seen = new Set<string>();
  const unique = items.filter((w) => {
    if (seen.has(w.id)) return false;
    seen.add(w.id);
    return true;
  });
  const active = typeof obj.activeWheelId === 'string' && unique.some((w) => w.id === obj.activeWheelId)
    ? obj.activeWheelId
    : null;
  const lastWinner = isValidWinner(obj.lastWinner) ? obj.lastWinner : null;
  return { items: unique, activeWheelId: active, lastWinner };
}

function isValidWinner(v: unknown): v is WheelWinner {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  return typeof w.wheelId === 'string' && typeof w.sliceId === 'string'
    && typeof w.label === 'string' && typeof w.at === 'string';
}

function isValidWheel(v: unknown): v is Wheel {
  if (!v || typeof v !== 'object') return false;
  const w = v as Record<string, unknown>;
  if (typeof w.id !== 'string' || !w.id) return false;
  if (typeof w.name !== 'string' || !w.name) return false;
  if (typeof w.createdAt !== 'string' || typeof w.updatedAt !== 'string') return false;
  if (typeof w.restRotationDeg !== 'number' || !Number.isFinite(w.restRotationDeg)) return false;
  if (!Array.isArray(w.slices)) return false;
  for (const s of w.slices) {
    if (!s || typeof s !== 'object') return false;
    const sl = s as Record<string, unknown>;
    if (typeof sl.id !== 'string' || !sl.id) return false;
    if (typeof sl.label !== 'string') return false;
    if (typeof sl.color !== 'string') return false;
    if (typeof sl.weight !== 'number' || !Number.isFinite(sl.weight) || sl.weight <= 0) return false;
  }
  return true;
}
