import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Workspace } from '@/lib/types';

/**
 * Loads the caller's own workspace. Invited testers ("members") may have none:
 * the API answers 404 and we treat any failure as "no workspace" so owner-only
 * UI can be hidden instead of erroring.
 */
export function useWorkspaceAccess() {
  const { data, isLoading, isError } = useQuery<Workspace>({
    queryKey: ['workspace-me'],
    queryFn: () => api.get<Workspace>('/workspaces/me'),
    retry: false,
  });
  return {
    workspace: data,
    isLoading,
    hasWorkspace: Boolean(data),
    // true only once we know the user has no workspace of their own
    isMemberOnly: !isLoading && (isError || !data),
  };
}
