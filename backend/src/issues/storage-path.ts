import { BadRequestException } from '@nestjs/common';

/**
 * Client-supplied storage paths are later signed and served, so they must point inside the
 * caller's own upload area: `${userId}/${projectId}/<file>` (the shape the upload endpoints
 * produce). Rejects anything else, including `..`/empty segments and leading slashes.
 */
export function assertOwnedStoragePath(path: string | undefined | null, userId: string, projectId: string): void {
  if (path === undefined || path === null) return;
  const prefix = `${userId}/${projectId}/`;
  const segments = typeof path === 'string' ? path.split('/') : [];
  const ok =
    typeof path === 'string' &&
    !!userId &&
    !!projectId &&
    path.startsWith(prefix) &&
    path.length > prefix.length &&
    !path.includes('\\') &&
    segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  if (!ok) throw new BadRequestException('Invalid storage path');
}
