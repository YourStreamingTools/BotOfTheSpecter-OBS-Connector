import type { WheelInput, WheelSlice } from './ipc';

/** Brand-adjacent slice palette; cycles when the streamer adds more options than colours. */
export const WHEEL_COLORS = [
  '#9B59B6', '#1ABC9C', '#3498DB', '#E74C3C', '#F39C12',
  '#2ECC71', '#E91E63', '#00BCD4', '#FF5722', '#8BC34A',
  '#673AB7', '#FFC107'
] as const;

export const MAX_WHEEL_SLICES = 100;
export const MIN_SLICES_TO_SPIN = 2;
export const MAX_WHEEL_NAME = 60;
export const MAX_SLICE_LABEL = 80;
export const SPIN_DURATION_MS = 5500;
export const EXTRA_TURNS_MIN = 5;
export const EXTRA_TURNS_MAX = 8;

export interface SliceLayout {
  id: string;
  label: string;
  color: string;
  weight: number;
  /** Degrees from 12 o'clock, clockwise. */
  startDeg: number;
  spanDeg: number;
  midDeg: number;
}

export function sliceColor(index: number, explicit?: string): string {
  const trimmed = (explicit ?? '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return WHEEL_COLORS[((index % WHEEL_COLORS.length) + WHEEL_COLORS.length) % WHEEL_COLORS.length];
}

/** Slices that can actually land on a spin (non-empty label, positive weight). */
export function spinnableSlices(slices: WheelSlice[]): WheelSlice[] {
  return slices.filter((s) => s.label.trim().length > 0 && s.weight > 0);
}

export function layoutSlices(slices: WheelSlice[]): SliceLayout[] {
  const usable = spinnableSlices(slices);
  const total = usable.reduce((sum, s) => sum + s.weight, 0);
  if (total <= 0) return [];
  let acc = 0;
  return usable.map((s, i) => {
    const spanDeg = (s.weight / total) * 360;
    const startDeg = acc;
    acc += spanDeg;
    return {
      id: s.id,
      label: s.label.trim(),
      color: sliceColor(i, s.color),
      weight: s.weight,
      startDeg,
      spanDeg,
      midDeg: startDeg + spanDeg / 2
    };
  });
}

/** Polar point for a wheel with 0° at 12 o'clock, clockwise. */
export function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

export function pickWeightedIndex(slices: WheelSlice[], random: () => number = Math.random): number {
  const usable = spinnableSlices(slices);
  if (usable.length === 0) return -1;
  const total = usable.reduce((sum, s) => sum + s.weight, 0);
  let r = random() * total;
  if (!Number.isFinite(r) || r < 0) r = 0;
  for (let i = 0; i < usable.length; i++) {
    r -= usable[i].weight;
    if (r < 0) return i;
  }
  return usable.length - 1;
}

/**
 * Rotation (CSS clockwise degrees) that lands `midDeg` under the 12 o'clock pointer,
 * travelling forward at least `extraTurns` full revolutions from `fromDeg`.
 */
export function spinTargetDeg(midDeg: number, fromDeg: number, extraTurns: number): number {
  const turns = Math.max(0, Math.floor(extraTurns));
  const targetMod = ((360 - (midDeg % 360)) + 360) % 360;
  const fromMod = ((fromDeg % 360) + 360) % 360;
  const delta = (targetMod - fromMod + 360) % 360;
  return fromDeg + turns * 360 + delta;
}

export function extraTurns(random: () => number = Math.random): number {
  const span = EXTRA_TURNS_MAX - EXTRA_TURNS_MIN + 1;
  return EXTRA_TURNS_MIN + Math.floor(random() * span);
}

export function validateWheelInput(input: WheelInput): string | null {
  const name = (input?.name ?? '').trim();
  if (!name) return 'Wheel name is required';
  if (name.length > MAX_WHEEL_NAME) return `Wheel name must be ${MAX_WHEEL_NAME} characters or fewer`;
  if (!Array.isArray(input?.slices)) return 'Options are required';
  if (input.slices.length > MAX_WHEEL_SLICES) return `A wheel can have at most ${MAX_WHEEL_SLICES} options`;
  for (const slice of input.slices) {
    const label = (slice?.label ?? '').trim();
    if (!label) return 'Every option needs a label';
    if (label.length > MAX_SLICE_LABEL) return `Option labels must be ${MAX_SLICE_LABEL} characters or fewer`;
    if (slice.weight != null && (!Number.isFinite(slice.weight) || slice.weight <= 0)) {
      return 'Option weight must be a number greater than 0';
    }
  }
  return null;
}
