import { describe, expect, it, vi } from 'vitest';
import { submitIssue } from '../api/createIssue';

function res(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const base = {
  apiUrl: 'http://api.test/',
  projectId: 'p1',
  form: { title: 'Broken', severity: 'Medium' as const },
};

describe('submitIssue', () => {
  it('posts with the current token and chosen project', async () => {
    const fetchImpl = vi.fn(async () => res(201, { id: 'i1' }));
    const tokens = { getAccessToken: vi.fn(async () => 't1'), refreshAfter401: vi.fn() };
    const r = await submitIssue({ ...base, tokens, fetchImpl: fetchImpl as any });
    expect(r).toEqual({ ok: true, data: { id: 'i1' } });
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe('http://api.test/api/issues');
    expect(init.headers.Authorization).toBe('Bearer t1');
    expect(JSON.parse(init.body).project_id).toBe('p1');
    expect(tokens.refreshAfter401).not.toHaveBeenCalled();
  });

  it('refreshes once after a 401 and retries with the new token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(res(201, { id: 'i1' }));
    const tokens = {
      getAccessToken: vi.fn(async () => 'old'),
      refreshAfter401: vi.fn(async () => 'new'),
    };
    const r = await submitIssue({ ...base, tokens, fetchImpl });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe('Bearer new');
  });

  it('gives up after one retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(401, { message: 'Unauthorized' }));
    const tokens = {
      getAccessToken: vi.fn(async () => 'old'),
      refreshAfter401: vi.fn(async () => 'new'),
    };
    const r = await submitIssue({ ...base, tokens, fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(tokens.refreshAfter401).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the refresh yields no token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(401, {}));
    const tokens = {
      getAccessToken: vi.fn(async () => 'old'),
      refreshAfter401: vi.fn(async () => null),
    };
    const r = await submitIssue({ ...base, tokens, fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 401 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('network failure resolves to a failed result (never throws)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Network request failed'));
    const tokens = { getAccessToken: vi.fn(async () => 't'), refreshAfter401: vi.fn() };
    const r = await submitIssue({ ...base, tokens, fetchImpl });
    expect(r).toMatchObject({ ok: false, status: 0 });
  });

  it('fails without calling the API when signed out', async () => {
    const fetchImpl = vi.fn();
    const tokens = { getAccessToken: vi.fn(async () => null), refreshAfter401: vi.fn() };
    const r = await submitIssue({ ...base, tokens, fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails without calling the API when no project is chosen', async () => {
    const fetchImpl = vi.fn();
    const tokens = { getAccessToken: vi.fn(async () => 't'), refreshAfter401: vi.fn() };
    const r = await submitIssue({ ...base, projectId: '', tokens, fetchImpl });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
