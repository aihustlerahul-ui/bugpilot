import { SourceMapService } from './source-map.service';

describe('SourceMapService', () => {
  let service: SourceMapService;

  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  beforeEach(() => {
    service = new SourceMapService();
    service.fetchOptions = { lookup: publicLookup };
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
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 3,
          sources: ['src/components/CheckoutButton.tsx'],
          names: ['handleClick'],
          mappings: 'AAAA',
        }),
      ),
    ) as any;

    const res = await service.resolveLocation('https://app.com/assets/main.min.js', 42, 10);
    expect(res.status).toBe('resolved');
    expect(res.originalFile).toContain('src/components/CheckoutButton.tsx');
    expect(res.originalName).toBe('handleClick');
  });

  it('should resolve full stack trace string', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 3,
          sources: ['src/App.tsx'],
          names: ['renderApp'],
          mappings: 'AAAA',
        }),
      ),
    ) as any;

    const rawStack = `Error: Crashed
    at onSubmit (https://app.com/bundle.js:12:34)`;

    const resolved = await service.resolveStackTrace(rawStack);
    expect(resolved).toContain('renderApp (src/App.tsx:12:34) [source-mapped]');
  });

  it('never fetches internal / metadata addresses (SSRF) and falls back', async () => {
    global.fetch = jest.fn() as any;
    for (const url of [
      'http://169.254.169.254/latest/meta-data/x.js',
      'http://127.0.0.1:4000/api/x.js',
      'http://10.0.0.8/app.js',
    ]) {
      const res = await service.resolveLocation(url, 1, 1);
      expect(res.status).toBe('fallback');
    }
    service.fetchOptions = { lookup: async () => [{ address: '192.168.1.5', family: 4 }] };
    expect((await service.resolveLocation('https://rebind.example.com/a.js', 1, 1)).status).toBe('fallback');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
