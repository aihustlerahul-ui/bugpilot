/**
 * Hosted bugPilot API. Hosts only set `config.apiUrl` when self-hosting or
 * pointing at a local backend (e.g. http://localhost:4000).
 */
export const DEFAULT_API_URL = 'https://bugpilot-api-8kk7.onrender.com';

/** Config value → API origin without a trailing slash; falls back to the hosted API. */
export function resolveApiUrl(apiUrl?: string | null): string {
  const v = apiUrl?.trim();
  return (v || DEFAULT_API_URL).replace(/\/+$/, '');
}
