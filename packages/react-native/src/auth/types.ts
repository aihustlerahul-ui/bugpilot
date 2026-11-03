export interface StorageAdapter {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

export type AuthUser = { id: string; email: string };

/** Mirrors backend AuthSession. expires_at is unix seconds. */
export type AuthSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: AuthUser;
};

export type ProjectSummary = { id: string; name: string };
