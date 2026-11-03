import { describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter } from '../auth/SessionStore';
import { AuthError } from '../auth/AuthClient';
import {
  loadLastProjectId,
  loadProjects,
  resolveInitialProject,
  saveLastProjectId,
} from '../projectSelection';

const A = { id: 'a' };
const B = { id: 'b' };

describe('resolveInitialProject', () => {
  it('locked project the user cannot access falls back to the picker with an error', () => {
    const r = resolveInitialProject([A, B], 'a', 'zzz');
    expect(r.projectId).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it('locked project the user can access is selected', () => {
    expect(resolveInitialProject([A, B], 'a', 'b')).toEqual({ projectId: 'b' });
  });

  it('single project is preselected', () => {
    expect(resolveInitialProject([A], null)).toEqual({ projectId: 'a' });
    expect(resolveInitialProject([A], 'gone')).toEqual({ projectId: 'a' });
  });

  it('otherwise the last used project is selected when still present', () => {
    expect(resolveInitialProject([A, B], 'b')).toEqual({ projectId: 'b' });
  });

  it('last used project that is no longer present leaves the picker open', () => {
    expect(resolveInitialProject([A, B], 'gone')).toEqual({ projectId: null });
    expect(resolveInitialProject([A, B], null)).toEqual({ projectId: null });
  });

  it('empty list resolves to null', () => {
    expect(resolveInitialProject([], 'a')).toEqual({ projectId: null });
  });
});

describe('last project persistence', () => {
  it('is stored per user id', async () => {
    const storage = createMemoryAdapter();
    await saveLastProjectId(storage, 'u1', 'a');
    await saveLastProjectId(storage, 'u2', 'b');
    expect(await loadLastProjectId(storage, 'u1')).toBe('a');
    expect(await loadLastProjectId(storage, 'u2')).toBe('b');
    expect(await loadLastProjectId(storage, 'u3')).toBeNull();
  });

  it('never throws when storage fails', async () => {
    const broken = {
      getItem: async () => {
        throw new Error('x');
      },
      setItem: async () => {
        throw new Error('x');
      },
      removeItem: async () => {},
    };
    await expect(saveLastProjectId(broken, 'u1', 'a')).resolves.toBeUndefined();
    await expect(loadLastProjectId(broken, 'u1')).resolves.toBeNull();
  });
});

describe('loadProjects', () => {
  const projects = [{ id: 'p1', name: 'P1' }];

  it('lists with the current token', async () => {
    const listProjects = vi.fn(async () => projects);
    const tokens = { getAccessToken: vi.fn(async () => 't1'), refreshAfter401: vi.fn() };
    await expect(loadProjects({ listProjects }, tokens)).resolves.toEqual(projects);
    expect(listProjects).toHaveBeenCalledWith('t1');
    expect(tokens.refreshAfter401).not.toHaveBeenCalled();
  });

  it('retries once with a refreshed token after a 401', async () => {
    const listProjects = vi
      .fn()
      .mockRejectedValueOnce(new AuthError('Could not load projects (HTTP 401)', 401))
      .mockResolvedValueOnce(projects);
    const tokens = {
      getAccessToken: vi.fn(async () => 'old'),
      refreshAfter401: vi.fn(async () => 'new'),
    };
    await expect(loadProjects({ listProjects }, tokens)).resolves.toEqual(projects);
    expect(listProjects.mock.calls).toEqual([['old'], ['new']]);
    expect(tokens.refreshAfter401).toHaveBeenCalledTimes(1);
  });

  it('does not retry a second time', async () => {
    const err = new AuthError('Could not load projects (HTTP 401)', 401);
    const listProjects = vi.fn().mockRejectedValue(err);
    const tokens = {
      getAccessToken: vi.fn(async () => 'old'),
      refreshAfter401: vi.fn(async () => 'new'),
    };
    await expect(loadProjects({ listProjects }, tokens)).rejects.toBe(err);
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it('does not refresh for non-401 failures', async () => {
    const listProjects = vi.fn().mockRejectedValue(new Error('boom'));
    const tokens = { getAccessToken: vi.fn(async () => 't'), refreshAfter401: vi.fn() };
    await expect(loadProjects({ listProjects }, tokens)).rejects.toThrow('boom');
    expect(tokens.refreshAfter401).not.toHaveBeenCalled();
  });

  it('rejects when signed out', async () => {
    const listProjects = vi.fn();
    const tokens = { getAccessToken: vi.fn(async () => null), refreshAfter401: vi.fn() };
    await expect(loadProjects({ listProjects }, tokens)).rejects.toThrow();
    expect(listProjects).not.toHaveBeenCalled();
  });
});
