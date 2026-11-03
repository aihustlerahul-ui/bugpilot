import type { AuthSession, ProjectSummary } from './types';

type FetchLike = typeof fetch;

export class AuthClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;

  constructor(apiUrl: string, fetchImpl?: FetchLike) {
    this.base = apiUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? ((...args) => fetch(...args));
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const res = await this.fetchImpl(`${this.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 401) throw new Error('Invalid email or password');
    if (!res.ok) throw new Error(`Sign-in failed (HTTP ${res.status})`);
    return (await res.json()) as AuthSession;
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const res = await this.fetchImpl(`${this.base}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) throw new Error(`Session refresh failed (HTTP ${res.status})`);
    return (await res.json()) as AuthSession;
  }

  async listProjects(accessToken: string): Promise<ProjectSummary[]> {
    const res = await this.fetchImpl(`${this.base}/api/projects`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Could not load projects (HTTP ${res.status})`);
    const rows = (await res.json()) as Array<{ id: string; name: string }>;
    return rows.map((p) => ({ id: p.id, name: p.name }));
  }
}
