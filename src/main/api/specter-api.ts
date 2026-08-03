import { BOTOFTHESPECTER_API_BASE } from '@shared/constants';
import type { ValidateResult, AccountInfo } from '@shared/ipc';

// Twitch API credentials from /v2/account; main-process only, access token never crosses IPC to renderer.
export interface TwitchCredentials {
  accessToken: string;
  broadcasterId: string;
  updatedAt?: string;
}

export interface SpecterApiDeps {
  fetch?: typeof fetch;
}

const CRED_TTL_MS = 3.5 * 60 * 60 * 1000; // ~3.5h — Twitch tokens last ~4h; leave margin for rotation.
const CRED_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** Talks to the BotOfTheSpecter HTTP API via the `X-API-KEY` header; `fetch` is injectable for unit tests. */
export class SpecterApiService {
  private fetch: typeof fetch;
  /** Shared cache so Helix helpers (polls/predictions/channel-points) and TwitchService don't re-hit /v2/account every call. */
  private credCache: { key: string; creds: TwitchCredentials; validUntil: number } | null = null;

  constructor(deps: SpecterApiDeps = {}) {
    this.fetch = deps.fetch ?? fetch;
  }

  /** Verify an API key via `GET /v2/checkkey`; valid returns `{ status: "Valid API Key", username }`, invalid returns `{ status: "Invalid API Key", username: null }`. */
  async validateApiKey(key: string): Promise<ValidateResult> {
    if (!key) return { valid: false, message: 'API key is empty' };
    try {
      const res = await this.fetch(`${BOTOFTHESPECTER_API_BASE}/v2/checkkey`, {
        headers: { accept: 'application/json', 'X-API-KEY': key }
      });
      if (!res.ok) return { valid: false, message: `Validation failed (HTTP ${res.status})` };
      const data = (await res.json()) as { status?: string; username?: string | null };
      const status = String(data.status ?? '').trim();
      const valid = status.toLowerCase() === 'valid api key' && Boolean(data.username);
      return { valid, username: data.username ?? undefined, message: status || 'Invalid API key' };
    } catch (err) {
      return { valid: false, message: err instanceof Error ? err.message : 'Validation failed' };
    }
  }

  /** Fetch account profile via `GET /v2/account`, returning only display-safe fields (OAuth tokens and api_key dropped so they never reach the renderer); `null` on missing key, HTTP error, or malformed payload. */
  async getAccount(key: string): Promise<AccountInfo | null> {
    if (!key) return null;
    try {
      const res = await this.fetch(`${BOTOFTHESPECTER_API_BASE}/v2/account`, {
        headers: { accept: 'application/json', 'X-API-KEY': key }
      });
      if (!res.ok) return null;
      const d = (await res.json()) as Record<string, unknown>;
      if (!d || typeof d.username !== 'string') return null;
      const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
      return {
        id: Number(d.id ?? 0),
        username: String(d.username),
        displayName: str(d.twitch_display_name) ?? String(d.username),
        twitchUserId: str(d.twitch_user_id) ?? '',
        profileImage: str(d.profile_image),
        isAdmin: Boolean(d.is_admin),
        betaAccess: Boolean(d.beta_access),
        isTechnical: Boolean(d.is_technical)
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch Twitch credentials from /v2/account (useable access token, broadcaster id from twitch_user_id, last-updated timestamp);
   * main-process only, for the Twitch Helix API. Results are cached per API key (~3.5h) unless `force` is set
   * (e.g. after a Helix 401) so polls/predictions/channel-points don't re-fetch on every 5s refresh.
   */
  async getCredentials(key: string, opts?: { force?: boolean }): Promise<TwitchCredentials | null> {
    if (!key) return null;
    if (!opts?.force && this.credCache && this.credCache.key === key && Date.now() < this.credCache.validUntil) {
      return this.credCache.creds;
    }
    try {
      const res = await this.fetch(`${BOTOFTHESPECTER_API_BASE}/v2/account`, {
        headers: { accept: 'application/json', 'X-API-KEY': key }
      });
      if (!res.ok) {
        if (this.credCache?.key === key) this.credCache = null;
        return null;
      }
      const d = (await res.json()) as { useable_access_token?: string; twitch_user_id?: string | number; useable_access_token_updated?: string };
      const accessToken = String(d.useable_access_token ?? '').trim();
      const broadcasterId = String(d.twitch_user_id ?? '').trim();
      if (!accessToken || !broadcasterId) {
        if (this.credCache?.key === key) this.credCache = null;
        return null;
      }
      const creds: TwitchCredentials = { accessToken, broadcasterId, updatedAt: d.useable_access_token_updated };
      this.credCache = { key, creds, validUntil: this.credValidUntil(creds.updatedAt) };
      return creds;
    } catch {
      return null;
    }
  }

  private credValidUntil(updatedAt?: string): number {
    if (updatedAt) {
      const raw = updatedAt.trim();
      const iso = /([zZ]|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
      const ms = Date.parse(iso);
      if (Number.isFinite(ms)) return ms + 4 * 60 * 60 * 1000 - CRED_EXPIRY_MARGIN_MS;
    }
    return Date.now() + CRED_TTL_MS;
  }
}
