import { BadRequestException } from '@nestjs/common';
import { assertOwnedStoragePath } from './storage-path';

describe('assertOwnedStoragePath', () => {
  it('accepts paths under user/project and ignores absent values', () => {
    expect(() => assertOwnedStoragePath('u1/p1/1700-video.webm', 'u1', 'p1')).not.toThrow();
    expect(() => assertOwnedStoragePath(undefined, 'u1', 'p1')).not.toThrow();
  });

  it.each([
    'u2/p1/x.webm',
    'u1/p2/x.webm',
    'u1/p1/',
    'u1/p1',
    '/u1/p1/x.webm',
    'u1/p1/../../u2/p1/x.webm',
    'u1/p1//x.webm',
    'u1/p1/./x.webm',
    'u1/p1\\..\\x',
    'u1/p10/x.webm',
    '',
  ])('rejects %p', (path) => {
    expect(() => assertOwnedStoragePath(path, 'u1', 'p1')).toThrow(BadRequestException);
  });
});
