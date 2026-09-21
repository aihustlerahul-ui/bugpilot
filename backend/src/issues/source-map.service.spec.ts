import { SourceMapService } from './source-map.service';

describe('SourceMapService', () => {
  let service: SourceMapService;

  beforeEach(() => {
    service = new SourceMapService();
  });

  it('should return fallback if no url is given', async () => {
    const res = await service.resolveLocation(undefined, 10, 5);
    expect(res.status).toBe('not_found');
    expect(res.originalFile).toBe('unknown');
  });

  it('should return fallback for non-http urls', async () => {
    const res = await service.resolveLocation('webpack:///./src/index.js', 10, 5);
    expect(res.status).toBe('fallback');
    expect(res.originalFile).toBe('webpack:///./src/index.js');
  });

  it('should resolve source location when sourcemap is fetched', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        version: 3,
        sources: ['src/components/CheckoutButton.tsx'],
        names: ['handleClick'],
        mappings: 'AAAA',
      }),
    }) as any;

    const res = await service.resolveLocation('https://app.com/assets/main.min.js', 42, 10);
    expect(res.status).toBe('resolved');
    expect(res.originalFile).toContain('src/components/CheckoutButton.tsx');
    expect(res.originalName).toBe('handleClick');
  });

  it('should resolve full stack trace string', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        version: 3,
        sources: ['src/App.tsx'],
        names: ['renderApp'],
        mappings: 'AAAA',
      }),
    }) as any;

    const rawStack = `Error: Crashed
    at onSubmit (https://app.com/bundle.js:12:34)`;

    const resolved = await service.resolveStackTrace(rawStack);
    expect(resolved).toContain('renderApp (src/App.tsx:12:34) [source-mapped]');
  });
});
