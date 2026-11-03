import type { AuthSession, ProjectSummary } from './types';

type FetchLike = typeof fetch;
type FetchResponse = Awaited<ReturnType<FetchLike>>;

export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/** Definitive rejection by the server (HTTP 400/401). Anything else is transient. */
export class AuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

export class AuthClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    apiUrl: string,
    fetchImpl?: FetchLike,
    private readonly timeoutMs: number = AUTH_REQUEST_TIMEOUT_MS,
  ) {
    this.base = apiUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
  }

  async login(email: string, password: string): Promise<AuthSession> {
    return this.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }, async (res) => {
      if (res.status === 401) throw new Error('Invalid email or password');
      if (res.status === 429) throw new Error('Too many attempts. Try again in a minute.');
      if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status})`);
      return (await res.json()) as AuthSession;
    });
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    return this.request('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, async (res) => {
      if (res.status === 400 || res.status === 401) {
        throw new AuthError('Session expired', res.status);
      }
      if (!res.ok) throw new Error(`Session refresh failed (HTTP ${res.status})`);
      return (await res.json()) as AuthSession;
    });
  }

  async listProjects(accessToken: string): Promise<ProjectSummary[]> {
    return this.request('/api/projects', {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }, async (res) => {
      const message = `Could not load projects (HTTP ${res.status})`;
      if (res.status === 401) throw new AuthError(message, 401);
      if (!res.ok) throw new Error(message);
      const rows = (await res.json()) as Array<{ id: string; name: string }>;
      return rows.map((p) => ({ id: p.id, name: p.name }));
    });
  }

  /**
   * Fetch + body handling under one deadline. A hung request rejects with a
   * transient (non-AuthError) error so TokenManager keeps the session and a
   * later refresh is not blocked behind it.
   */
  private request<T>(
    path: string,
    init: { method: string; headers: Record<string, string>; body?: string },
    handle: (res: FetchResponse) => Promise<T>,
  ): Promise<T> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        reject(new Error('Request timed out'));
      }, this.timeoutMs);
    });
    const work = (async () => {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        ...init,
        ...(controller ? { signal: controller.signal } : {}),
      });
      return handle(res);
    })();
    // Avoid an unhandled rejection from the losing branch.
    work.catch(() => undefined);
    return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
  }
}
