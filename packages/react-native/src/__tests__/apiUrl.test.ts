import { describe, expect, it } from 'vitest';
import { DEFAULT_API_URL, resolveApiUrl } from '../apiUrl';

describe('resolveApiUrl', () => {
  it('defaults to the hosted API when unset or blank', () => {
    expect(resolveApiUrl()).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl('  ')).toBe(DEFAULT_API_URL);
    expect(resolveApiUrl(null)).toBe(DEFAULT_API_URL);
  });
  it('uses an override and strips trailing slashes', () => {
    expect(resolveApiUrl('http://localhost:4000/')).toBe('http://localhost:4000');
  });
});
