import { describe, it, expect } from 'vitest';
import {
  activityEventKey, collectActivityEvents, isActivityVisible, parseMutedEvents, DEFAULT_MUTED_EVENTS
} from './activity-filter';
import type { LogEntry, LogSource } from './ipc';

const ALL = new Set<LogSource>(['OBS', 'TWITCH', 'WS', 'BOT', 'APP']);

const entry = (over: Partial<LogEntry>): LogEntry => ({
  t: '00:00:00.000', src: 'BOT', level: 'info', message: 'hello', ...over
});

describe('parseMutedEvents', () => {
  it('defaults to CLOSED_CAPTION when unset', () => {
    expect(parseMutedEvents(undefined)).toEqual([...DEFAULT_MUTED_EVENTS]);
  });

  it('keeps an explicit empty list (user unmuted everything)', () => {
    expect(parseMutedEvents([])).toEqual([]);
  });

  it('drops non-strings and blanks', () => {
    expect(parseMutedEvents(['CLOSED_CAPTION', 1, '  ', 'FOO', 'FOO'])).toEqual(['CLOSED_CAPTION', 'FOO']);
  });
});

describe('activityEventKey', () => {
  it('prefers the structured event field', () => {
    expect(activityEventKey({ message: 'said hi', event: 'CLOSED_CAPTION' })).toBe('CLOSED_CAPTION');
  });

  it('falls back to a SNAKE_CASE message', () => {
    expect(activityEventKey({ message: 'CLOSED_CAPTION' })).toBe('CLOSED_CAPTION');
    expect(activityEventKey({ message: 'owl followed' })).toBeNull();
  });
});

describe('isActivityVisible', () => {
  it('hides muted event names even when the source is on', () => {
    const muted = new Set(['CLOSED_CAPTION']);
    expect(isActivityVisible(entry({ message: 'CLOSED_CAPTION', event: 'CLOSED_CAPTION' }), ALL, muted)).toBe(false);
    expect(isActivityVisible(entry({ message: 'Executed inbound OBS request' }), ALL, muted)).toBe(true);
  });

  it('hides a source that is toggled off', () => {
    const src = new Set<LogSource>(['OBS']);
    expect(isActivityVisible(entry({ src: 'BOT', message: 'x' }), src, new Set())).toBe(false);
  });
});

describe('collectActivityEvents', () => {
  it('always includes the default muted names, then others from the log', () => {
    expect(collectActivityEvents([
      entry({ message: 'SOUND_ALERT', event: 'SOUND_ALERT' })
    ])).toEqual(['CLOSED_CAPTION', 'SOUND_ALERT']);
  });
});
