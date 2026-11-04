type TokenSource = { getAccessToken(): Promise<string | null> };

/** Config override wins (CI); otherwise the TokenManager. Never throws. */
export async function resolveAccessToken(
  config: { getAccessToken?: () => Promise<string | null> },
  manager: TokenSource,
): Promise<string | null> {
  try {
    return config.getAccessToken ? await config.getAccessToken() : await manager.getAccessToken();
  } catch {
    return null;
  }
}
