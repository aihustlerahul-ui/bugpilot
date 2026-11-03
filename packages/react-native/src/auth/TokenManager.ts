import { AuthError, type AuthClient } from './AuthClient';
import type { AuthSession, AuthUser, StorageAdapter } from './types';

const SESSION_KEY = 'bugpilot.session';
const REFRESH_SKEW_SECONDS = 60;

export class TokenManager {
  private inFlight: Promise<string | null> | null = null;
  /** Bumped on sign-in/out so a refresh already in flight cannot resurrect a session. */
  private generation = 0;

  constructor(
    private readonly client: AuthClient,
    private readonly storage: StorageAdapter,
    private readonly onSignedOut: () => void,
  ) {}

  /** Errors intentionally propagate so the sign-in UI can show them. */
  async signIn(email: string, password: string): Promise<AuthSession> {
    const session = await this.client.login(email, password);
    this.generation++;
    await this.storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async signOut(): Promise<void> {
    this.generation++;
    try {
      await this.storage.removeItem(SESSION_KEY);
    } catch {
      // storage failure must not throw into the host
    }
  }

  async getUser(): Promise<AuthUser | null> {
    return (await this.readSession())?.user ?? null;
  }

  /** Never throws: returns null when signed out or refresh fails. */
  async getAccessToken(): Promise<string | null> {
    const session = await this.readSession();
    if (!session) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (session.expires_at - nowSec > REFRESH_SKEW_SECONDS) return session.access_token;
    return this.refreshAfter401();
  }

  /** De-duplicated: concurrent callers share one refresh request. */
  refreshAfter401(): Promise<string | null> {
    if (!this.inFlight) {
      this.inFlight = this.doRefresh().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async doRefresh(): Promise<string | null> {
    const session = await this.readSession();
    if (!session) return null;
    const gen = this.generation;
    try {
      const next = await this.client.refresh(session.refresh_token);
      if (gen !== this.generation) return null; // signed out/in while in flight
      await this.storage.setItem(SESSION_KEY, JSON.stringify(next));
      return next.access_token;
    } catch (e) {
      // Transient failures (network, timeout, 5xx) keep the session for a later retry.
      if (!(e instanceof AuthError) || gen !== this.generation) return null;
      await this.signOut();
      try {
        this.onSignedOut();
      } catch {
        // host callback errors are not ours to propagate
      }
      return null;
    }
  }

  private async readSession(): Promise<AuthSession | null> {
    let raw: string | null;
    try {
      raw = await this.storage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as AuthSession;
      if (
        p &&
        typeof p.access_token === 'string' &&
        typeof p.refresh_token === 'string' &&
        typeof p.expires_at === 'number' &&
        Number.isFinite(p.expires_at)
      ) {
        return p;
      }
    } catch {
      // fall through to discard
    }
    try {
      await this.storage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}
