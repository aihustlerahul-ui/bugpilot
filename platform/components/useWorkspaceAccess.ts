import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api/client';
import type { Workspace } from '@/lib/types';

/**
 * Loads the caller's own workspace. Invited testers ("members") may have none:
 * the API answers 404 and we treat any failure as "no workspace" so owner-only
 * UI can be hidden instead of erroring.
 */
export function useWorkspaceAccess() {
  const { data, isLoading, isError, error } = useQuery<Workspace>({
    queryKey: ['workspace-me'],
    queryFn: () => api.get<Workspace>('/workspaces/me'),
    // A 404 is the definitive "no workspace" answer; do not retry it. Other errors
    // (5xx, network) are transient: retry a couple of times and keep owner UI meanwhile.
    retry: (failureCount, err) => !(err instanceof ApiError && err.status === 404) && failureCount < 2,
  });
  return {
    workspace: data,
    isLoading,
    hasWorkspace: Boolean(data),
    // true only on a definitive 404 (no workspace of their own)
    isMemberOnly: !isLoading && !data && isError && error instanceof ApiError && error.status === 404,
  };
}
