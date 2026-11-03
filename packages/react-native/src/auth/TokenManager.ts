import type { AuthClient } from './AuthClient';
import type { AuthSession, AuthUser, StorageAdapter } from './types';

const SESSION_KEY = 'bugpilot.session';
const REFRESH_SKEW_SECONDS = 60;

export class TokenManager {
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly client: AuthClient,
    private readonly storage: StorageAdapter,
    private readonly onSignedOut: () => void,
  ) {}

  async signIn(email: string, password: string): Promise<AuthSession> {
    const session = await this.client.login(email, password);
    await this.storage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  async signOut(): Promise<void> {
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
    try {
      const next = await this.client.refresh(session.refresh_token);
      await this.storage.setItem(SESSION_KEY, JSON.stringify(next));
      return next.access_token;
    } catch {
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
    try {
      const raw = await this.storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AuthSession;
      return parsed && typeof parsed.access_token === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
}
