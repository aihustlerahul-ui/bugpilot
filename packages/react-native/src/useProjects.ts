import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageAdapter } from './auth/types';
import {
  LOCKED_PROJECT_UNAVAILABLE,
  loadLastProjectId,
  loadProjects,
  resolveInitialProject,
  saveLastProjectId,
  type ProjectLister,
  type TokenSource,
} from './projectSelection';
import type { ProjectsState } from './types';

const IDLE: ProjectsState = { status: 'idle', projects: [], error: null };
const LOAD_FAILED = "Couldn't load projects. Check your connection and retry.";

export type UseProjectsOptions = {
  client: ProjectLister | null;
  tokens: TokenSource;
  storage: StorageAdapter | null;
  /** Signed-in user id (or a fixed key for the token override); null resets. */
  userKey: string | null;
  lockedProjectId?: string;
};

export type UseProjectsResult = {
  projects: ProjectsState;
  reload: () => void;
  projectId: string | null;
  setProjectId: (projectId: string) => void;
  projectLocked: boolean;
};

/**
 * Loads the user's projects (retrying once after a 401), resolves the
 * initial selection and persists the last choice per user. Never throws.
 */
export function useProjects({
  client,
  tokens,
  storage,
  userKey,
  lockedProjectId,
}: UseProjectsOptions): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectsState>(IDLE);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [projectLocked, setProjectLocked] = useState(false);
  const [nonce, setNonce] = useState(0);
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userKey || !client) {
      loadedForRef.current = null;
      setProjects(IDLE);
      setProjectIdState(null);
      setProjectLocked(false);
      return;
    }
    if (loadedForRef.current !== userKey) {
      // Different user: never carry a previous user's selection over.
      loadedForRef.current = userKey;
      setProjectIdState(null);
      setProjectLocked(false);
    }
    let cancelled = false;
    setProjects((prev) => ({ status: 'loading', projects: prev.projects, error: null }));
    void (async () => {
      try {
        const list = await loadProjects(client, tokensRef.current);
        const last = storage ? await loadLastProjectId(storage, userKey) : null;
        if (cancelled) return;
        const resolved = resolveInitialProject(list, last, lockedProjectId);
        setProjects({ status: 'ready', projects: list, error: resolved.error ?? null });
        const locked = !!lockedProjectId && !resolved.error;
        // On reload keep a still-valid manual choice unless the build locks one.
        setProjectIdState((prev) =>
          !locked && prev && list.some((p) => p.id === prev) ? prev : resolved.projectId,
        );
        setProjectLocked(locked);
      } catch {
        if (cancelled) return;
        setProjects({ status: 'error', projects: [], error: LOAD_FAILED });
        if (lockedProjectId) {
          // Keep the pre-auth behaviour for locked builds (e.g. CI token override).
          setProjectIdState(lockedProjectId);
          setProjectLocked(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, storage, userKey, lockedProjectId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const setProjectId = useCallback(
    (id: string) => {
      if (projectLocked) return;
      setProjectIdState(id);
      // A valid manual pick resolves the "locked project unavailable" notice.
      setProjects((p) => (p.error === LOCKED_PROJECT_UNAVAILABLE ? { ...p, error: null } : p));
      if (storage && userKey) void saveLastProjectId(storage, userKey, id);
    },
    [projectLocked, storage, userKey],
  );

  return { projects, reload, projectId, setProjectId, projectLocked };
}
