// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { TwitchService, toUtcIso } from './twitch-service';
import type { TwitchStatus } from '@shared/ipc';

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
// Fresh updatedAt so the cached token is well within its 4h validity for the test run.
const freshCreds = () => ({ accessToken: 'TOK', broadcasterId: '1234567', updatedAt: new Date().toISOString() });

describe('TwitchService', () => {
  it('reports online with game/title/viewers when a stream is live', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ game_name: 'Minecraft', title: 'building', viewer_count: 42, started_at: 't0' }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials: vi.fn().mockResolvedValue(freshCreds()), clientId: 'CID' });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(svc.getStatus()).toMatchObject({ reachable: true, online: true, game: 'Minecraft', title: 'building', viewers: 42 });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('/streams?user_id=1234567');
    const h = (opts as { headers: Record<string, string> }).headers;
    expect(h.Authorization).toBe('Bearer TOK');
    expect(h['Client-Id']).toBe('CID');
  });

  it('falls back to channel info for the game/title when offline', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Just Chatting', title: 'brb' }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials: vi.fn().mockResolvedValue(freshCreds()) });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(svc.getStatus()).toMatchObject({ reachable: true, online: false, game: 'Just Chatting', title: 'brb' });
    expect(fetchMock.mock.calls[1][0]).toContain('/channels?broadcaster_id=1234567');
  });

  it('caches the token across refreshes (no /v2/account refetch within TTL)', async () => {
    const getCredentials = vi.fn().mockResolvedValue(freshCreds());
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials });
    svc.setApiKey('KEY');
    await svc.refresh();
    await svc.refresh();
    await svc.refresh();
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });

  it('re-fetches the token once when Twitch returns 401', async () => {
    const getCredentials = vi.fn().mockResolvedValue(freshCreds());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'X' }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(getCredentials).toHaveBeenCalledTimes(2);
    expect(svc.getStatus().reachable).toBe(true);
  });

  it('registers the fetched Twitch access token as a secret so it is scrubbed from logs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [] }));
    const registerSecret = vi.fn();
    const svc = new TwitchService({ fetch: fetchMock, getCredentials: vi.fn().mockResolvedValue(freshCreds()), registerSecret });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(registerSecret).toHaveBeenCalledWith('TOK');
  });

  it('is unreachable without an API key (no calls)', async () => {
    const getCredentials = vi.fn();
    const fetchMock = vi.fn();
    const svc = new TwitchService({ fetch: fetchMock, getCredentials });
    await svc.refresh();
    expect(svc.getStatus()).toEqual({ reachable: false, online: false });
    expect(getCredentials).not.toHaveBeenCalled();
  });

  it('resets and re-emits OFFLINE status when the API key is cleared', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [{ game_name: 'X', title: 'Y', viewer_count: 1 }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials: vi.fn().mockResolvedValue(freshCreds()) });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(svc.getStatus().online).toBe(true);

    const seen: TwitchStatus[] = [];
    svc.on('status', (s: TwitchStatus) => seen.push(s));
    svc.setApiKey('');
    expect(svc.getStatus()).toEqual({ reachable: false, online: false });
    expect(seen.at(-1)).toEqual({ reachable: false, online: false });
  });

  it('coalesces overlapping refresh() calls so credentials are fetched once', async () => {
    const getCredentials = vi.fn().mockResolvedValue(freshCreds());
    const fetchMock = vi.fn().mockResolvedValue(json({ data: [] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials });
    svc.setApiKey('KEY');
    await Promise.all([svc.refresh(), svc.refresh()]);
    expect(getCredentials).toHaveBeenCalledTimes(1);
  });

  it('does not flip online→offline on a single Helix empty-stream poll (session-counter flap guard)', async () => {
    const getCredentials = vi.fn().mockResolvedValue(freshCreds());
    // Live, then one empty /streams (would be a flap), then live again.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Game', title: 'live', viewer_count: 5 }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Just Chatting', title: 'brb' }] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Game', title: 'live', viewer_count: 6 }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials, offlineConfirmPolls: 2 });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(svc.getStatus().online).toBe(true);
    await svc.refresh(); // single offline flap — stay online
    expect(svc.getStatus().online).toBe(true);
    await svc.refresh(); // confirmed live again
    expect(svc.getStatus()).toMatchObject({ online: true, viewers: 6 });
  });

  it('flips online→offline after enough consecutive offline polls', async () => {
    const getCredentials = vi.fn().mockResolvedValue(freshCreds());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Game', title: 'live', viewer_count: 1 }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Just Chatting', title: 'ended' }] }))
      .mockResolvedValueOnce(json({ data: [] }))
      .mockResolvedValueOnce(json({ data: [{ game_name: 'Just Chatting', title: 'ended' }] }));
    const svc = new TwitchService({ fetch: fetchMock, getCredentials, offlineConfirmPolls: 2 });
    svc.setApiKey('KEY');
    await svc.refresh();
    expect(svc.getStatus().online).toBe(true);
    await svc.refresh(); // first offline — still online
    expect(svc.getStatus().online).toBe(true);
    await svc.refresh(); // second offline — confirm offline
    expect(svc.getStatus()).toMatchObject({ reachable: true, online: false, title: 'ended' });
  });
});

describe('toUtcIso', () => {
  it('treats an offset-less space-separated timestamp as UTC', () => {
    expect(toUtcIso('2026-05-30 10:00:00')).toBe('2026-05-30T10:00:00Z');
  });
  it('treats an offset-less ISO timestamp as UTC (was previously parsed as local)', () => {
    expect(toUtcIso('2026-05-30T10:00:00')).toBe('2026-05-30T10:00:00Z');
  });
  it('preserves an explicit Z or numeric offset', () => {
    expect(toUtcIso('2026-05-30T10:00:00Z')).toBe('2026-05-30T10:00:00Z');
    expect(toUtcIso('2026-05-30T10:00:00+05:00')).toBe('2026-05-30T10:00:00+05:00');
  });
});
