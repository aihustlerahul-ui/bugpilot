/**
 * Pure project-selection helpers (no react / react-native imports so vitest
 * can exercise them directly).
 */
import { AuthError } from './auth/AuthClient';
import type { ProjectSummary, StorageAdapter } from './auth/types';

export const LOCKED_PROJECT_UNAVAILABLE =
  'The project set for this build is not shared with you. Pick another project.';

/**
 * Decide which project is selected once the project list is known.
 * - Locked project the user can access → that project.
 * - Locked project the user cannot access → no selection (picker) + error.
 * - Exactly one project → preselected.
 * - Otherwise the last used project when still present, else no selection.
 */
export function resolveInitialProject(
  projects: Array<{ id: string }>,
  lastProjectId: string | null,
  lockedProjectId?: string,
): { projectId: string | null; error?: string } {
  const has = (id: string | null | undefined) => !!id && projects.some((p) => p.id === id);

  if (lockedProjectId) {
    if (has(lockedProjectId)) return { projectId: lockedProjectId };
    return { projectId: null, error: LOCKED_PROJECT_UNAVAILABLE };
  }
  if (projects.length === 0) return { projectId: null };
  if (projects.length === 1 && projects[0]) return { projectId: projects[0].id };
  if (has(lastProjectId)) return { projectId: lastProjectId };
  return { projectId: null };
}

export function lastProjectKey(userId: string): string {
  return `bugpilot.lastProject.${userId}`;
}

/** Never throws. */
export async function loadLastProjectId(
  storage: StorageAdapter,
  userId: string,
): Promise<string | null> {
  try {
    return (await storage.getItem(lastProjectKey(userId))) || null;
  } catch {
    return null;
  }
}

/** Never throws. */
export async function saveLastProjectId(
  storage: StorageAdapter,
  userId: string,
  projectId: string,
): Promise<void> {
  try {
    await storage.setItem(lastProjectKey(userId), projectId);
  } catch {
    // persistence is best-effort
  }
}

export type TokenSource = {
  getAccessToken(): Promise<string | null>;
  refreshAfter401(): Promise<string | null>;
};

export type ProjectLister = {
  listProjects(accessToken: string): Promise<ProjectSummary[]>;
};

/** Lists projects with the current token; on 401 refreshes once and retries. */
export async function loadProjects(
  client: ProjectLister,
  tokens: TokenSource,
): Promise<ProjectSummary[]> {
  const token = await tokens.getAccessToken();
  if (!token) throw new Error('Not signed in');
  try {
    return await client.listProjects(token);
  } catch (e) {
    if (!(e instanceof AuthError) || e.status !== 401) throw e;
    const next = await tokens.refreshAfter401();
    if (!next) throw e;
    return client.listProjects(next);
  }
}
