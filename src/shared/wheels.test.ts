import { describe, it, expect } from 'vitest';
import {
  extraTurns, layoutSlices, pickWeightedIndex, sliceColor, spinTargetDeg,
  spinnableSlices, validateWheelInput, EXTRA_TURNS_MIN, EXTRA_TURNS_MAX
} from './wheels';
import type { WheelSlice } from './ipc';

const slice = (over: Partial<WheelSlice> & { id: string; label: string }): WheelSlice => ({
  color: '#9B59B6', weight: 1, ...over
});

describe('sliceColor', () => {
  it('accepts a hex colour and otherwise cycles the palette', () => {
    expect(sliceColor(0, '#ff00aa')).toBe('#ff00aa');
    expect(sliceColor(0, 'nope')).toBe('#9B59B6');
    expect(sliceColor(1)).toBe('#1ABC9C');
  });
});

describe('layoutSlices', () => {
  it('splits the circle by weight starting at 12 o\'clock', () => {
    const layout = layoutSlices([
      slice({ id: 'a', label: 'A', weight: 1 }),
      slice({ id: 'b', label: 'B', weight: 3 })
    ]);
    expect(layout).toHaveLength(2);
    expect(layout[0].spanDeg).toBe(90);
    expect(layout[0].startDeg).toBe(0);
    expect(layout[0].midDeg).toBe(45);
    expect(layout[1].spanDeg).toBe(270);
    expect(layout[1].startDeg).toBe(90);
  });

  it('skips empty labels', () => {
    expect(layoutSlices([
      slice({ id: 'a', label: '  ' }),
      slice({ id: 'b', label: 'Yes' })
    ])).toHaveLength(1);
  });
});

describe('pickWeightedIndex', () => {
  it('returns -1 when nothing is spinnable', () => {
    expect(pickWeightedIndex([])).toBe(-1);
  });

  it('picks by cumulative weight using the supplied rng', () => {
    const slices = [
      slice({ id: 'a', label: 'A', weight: 1 }),
      slice({ id: 'b', label: 'B', weight: 1 })
    ];
    expect(pickWeightedIndex(slices, () => 0)).toBe(0);
    expect(pickWeightedIndex(slices, () => 0.6)).toBe(1);
  });
});

describe('spinTargetDeg', () => {
  it('lands the slice midpoint under the top pointer after extra turns', () => {
    // midDeg 45 → rotation must be 315 mod 360 so 45+R ≡ 0.
    const to = spinTargetDeg(45, 0, 5);
    expect(to).toBe(5 * 360 + 315);
    expect((45 + to) % 360).toBe(0);
  });

  it('travels forward from a non-zero rest angle', () => {
    const to = spinTargetDeg(0, 40, 5);
    expect(to).toBeGreaterThan(40);
    expect((((0 + to) % 360) + 360) % 360).toBe(0);
  });
});

describe('extraTurns', () => {
  it('stays in the configured range', () => {
    expect(extraTurns(() => 0)).toBe(EXTRA_TURNS_MIN);
    expect(extraTurns(() => 0.999)).toBe(EXTRA_TURNS_MAX);
  });
});

describe('validateWheelInput', () => {
  it('requires a name and labelled options', () => {
    expect(validateWheelInput({ name: '  ', slices: [{ label: 'A' }] })).toMatch(/name/i);
    expect(validateWheelInput({ name: 'Wheel', slices: [{ label: '  ' }] })).toMatch(/label/i);
    expect(validateWheelInput({ name: 'Wheel', slices: [{ label: 'A' }, { label: 'B' }] })).toBeNull();
  });
});

describe('spinnableSlices', () => {
  it('drops empty labels and non-positive weights', () => {
    expect(spinnableSlices([
      slice({ id: 'a', label: 'A', weight: 0 }),
      slice({ id: 'b', label: 'B', weight: 1 })
    ]).map((s) => s.id)).toEqual(['b']);
  });
});
