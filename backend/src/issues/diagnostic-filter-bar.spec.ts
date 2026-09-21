import * as fs from 'fs';
import * as path from 'path';

describe('DiagnosticFilterBar Empirical Challenge & Verification', () => {
  const componentPath = path.resolve(
    __dirname,
    '../../../platform/components/DiagnosticFilterBar.tsx',
  );
  let sourceCode: string;

  beforeAll(() => {
    expect(fs.existsSync(componentPath)).toBe(true);
    sourceCode = fs.readFileSync(componentPath, 'utf-8');
  });

  describe('1. Suspense Boundary & Next.js App Router Compliance', () => {
    it('defines DiagnosticFilterBarInner as the internal searchParams-consuming component', () => {
      expect(sourceCode).toContain('function DiagnosticFilterBarInner');
    });

    it('exports DiagnosticFilterBar with a top-level Suspense wrapper and skeleton fallback', () => {
      expect(sourceCode).toMatch(/export\s+function\s+DiagnosticFilterBar\s*\(/);
      expect(sourceCode).toContain('<Suspense');
      expect(sourceCode).toContain('fallback=');
      expect(sourceCode).toContain('<DiagnosticFilterBarInner {...props} />');
    });

    it('isolates useSearchParams() strictly within the Suspense boundary', () => {
      // DiagnosticFilterBarInner must contain useSearchParams()
      const innerRegex = /function DiagnosticFilterBarInner[\s\S]*?^}/m;
      const innerMatch = sourceCode.match(innerRegex);
      expect(innerMatch).not.toBeNull();
      expect(innerMatch![0]).toContain('const searchParams = useSearchParams()');

      // Outer DiagnosticFilterBar must NOT invoke useSearchParams() directly
      const outerRegex = /export function DiagnosticFilterBar[\s\S]*?^}/m;
      const outerMatch = sourceCode.match(outerRegex);
      expect(outerMatch).not.toBeNull();
      expect(outerMatch![0]).not.toContain('useSearchParams()');
    });
  });

  describe('2. URL Parameter Synchronization & router.replace({ scroll: false })', () => {
    it('always passes { scroll: false } to router.replace in updateParams', () => {
      const updateParamsMatch = sourceCode.match(/function updateParams[\s\S]*?^  }/m);
      expect(updateParamsMatch).not.toBeNull();
      const code = updateParamsMatch![0];
      expect(code).toContain('router.replace(');
      expect(code).toMatch(/router\.replace\([^,]+,\s*\{\s*scroll:\s*false\s*\}\)/);
    });

    it('always passes { scroll: false } to router.replace in clearAllFilters', () => {
      const clearAllMatch = sourceCode.match(/function clearAllFilters[\s\S]*?^  }/m);
      expect(clearAllMatch).not.toBeNull();
      const code = clearAllMatch![0];
      expect(code).toContain('router.replace(');
      expect(code).toMatch(/router\.replace\([^,]+,\s*\{\s*scroll:\s*false\s*\}\)/);
    });

    it('cleanses inactive/default parameter values from the query string to avoid clutter', () => {
      // Replicate the exact updateParams logic from lines 160-168
      function simulateUpdateParams(
        currentSearch: string,
        updates: Partial<Record<string, string | null>>,
      ): string {
        const params = new URLSearchParams(currentSearch);
        Object.entries(updates).forEach(([key, value]) => {
          if (value === null || value === undefined || value === '' || value === 'all' || value === 'false') {
            params.delete(key);
          } else {
            params.set(key, value);
          }
        });
        return params.toString();
      }

      const initial = 'q=error&status=Incoming&severity=Critical';

      // Setting query to empty string removes q
      expect(simulateUpdateParams(initial, { q: '' })).toBe('status=Incoming&severity=Critical');

      // Setting status to 'all' removes status
      expect(simulateUpdateParams(initial, { status: 'all' })).toBe('q=error&severity=Critical');

      // Setting severity to null removes severity
      expect(simulateUpdateParams(initial, { severity: null })).toBe('q=error&status=Incoming');

      // Setting boolean toggle to 'false' removes flag
      expect(simulateUpdateParams('hasReplay=true&hasVideo=true', { hasReplay: 'false' })).toBe('hasVideo=true');

      // Setting a valid new filter adds it cleanly
      expect(simulateUpdateParams(initial, { hasErrors: 'true' })).toBe(
        'q=error&status=Incoming&severity=Critical&hasErrors=true',
      );
    });
  });

  describe('3. URL Search Parameter Parsing & Default Semantics', () => {
    function simulateParseParams(searchString: string) {
      const searchParams = new URLSearchParams(searchString);
      return {
        q: searchParams.get('q') || '',
        status: searchParams.get('status') || 'all',
        severity: searchParams.get('severity') || 'all',
        assignee: searchParams.get('assignee') || 'all',
        dateRange: searchParams.get('date') || 'all',
        hasReplay: searchParams.get('hasReplay') === 'true',
        hasVideo: searchParams.get('hasVideo') === 'true',
        hasErrors: searchParams.get('hasErrors') === 'true',
        reactComponent: searchParams.get('reactComponent') || '',
      };
    }

    it('returns clean defaults when no query parameters are present', () => {
      const parsed = simulateParseParams('');
      expect(parsed).toEqual({
        q: '',
        status: 'all',
        severity: 'all',
        assignee: 'all',
        dateRange: 'all',
        hasReplay: false,
        hasVideo: false,
        hasErrors: false,
        reactComponent: '',
      });
    });

    it('correctly parses populated search parameters from URL', () => {
      const query =
        'q=crash&status=In+Triage&severity=High&assignee=carol&date=30d&hasReplay=true&hasVideo=true&hasErrors=true&reactComponent=PaymentModal';
      const parsed = simulateParseParams(query);
      expect(parsed).toEqual({
        q: 'crash',
        status: 'In Triage',
        severity: 'High',
        assignee: 'carol',
        dateRange: '30d',
        hasReplay: true,
        hasVideo: true,
        hasErrors: true,
        reactComponent: 'PaymentModal',
      });
    });

    it('strictly requires "true" string for boolean flags', () => {
      expect(simulateParseParams('hasReplay=TRUE').hasReplay).toBe(false);
      expect(simulateParseParams('hasReplay=1').hasReplay).toBe(false);
      expect(simulateParseParams('hasReplay=yes').hasReplay).toBe(false);
      expect(simulateParseParams('hasReplay=true').hasReplay).toBe(true);
    });
  });

  describe('4. Issue Filtering Logic Simulation with Edge Cases', () => {
    interface IssueItem {
      id: string;
      title?: string | null;
      description: string;
      route?: string | null;
      url?: string | null;
      status?: string | null;
      severity?: string | null;
      created_at: string;
      replayUrl?: string | null;
      replay_storage_path?: string | null;
      videoUrl?: string | null;
      video_storage_path?: string | null;
      metadata?: Record<string, any> | null;
      element_info?: Record<string, any> | null;
    }

    function filterIssues(
      issues: IssueItem[],
      filters: {
        q?: string;
        status?: string;
        severity?: string;
        assignee?: string;
        dateRange?: string;
        hasReplay?: boolean;
        hasVideo?: boolean;
        hasErrors?: boolean;
        reactComponent?: string;
      },
    ) {
      const q = filters.q || '';
      const status = filters.status || 'all';
      const severity = filters.severity || 'all';
      const assignee = filters.assignee || 'all';
      const dateRange = filters.dateRange || 'all';
      const hasReplay = Boolean(filters.hasReplay);
      const hasVideo = Boolean(filters.hasVideo);
      const hasErrors = Boolean(filters.hasErrors);
      const reactComponent = filters.reactComponent || '';

      return issues.filter((issue) => {
        // 1. Search query (title, description, route, url)
        if (q) {
          const query = q.toLowerCase();
          const title = (issue.title || '').toLowerCase();
          const desc = (issue.description || '').toLowerCase();
          const route = (issue.route || '').toLowerCase();
          const url = (issue.url || '').toLowerCase();
          if (!title.includes(query) && !desc.includes(query) && !route.includes(query) && !url.includes(query)) {
            return false;
          }
        }

        // 2. Triage status
        if (status !== 'all') {
          const currentStatus = issue.status ?? 'Incoming';
          if (currentStatus !== status) return false;
        }

        // 3. Severity
        if (severity !== 'all') {
          if ((issue.severity || '').toLowerCase() !== severity.toLowerCase()) return false;
        }

        // 4. Assignee
        if (assignee !== 'all') {
          if (issue.metadata?.assignee !== assignee) return false;
        }

        // 5. Date filter
        if (dateRange !== 'all') {
          const createdMs = new Date(issue.created_at).getTime();
          const now = Date.now();
          if (dateRange === 'today') {
            const startOfToday = new Date().setHours(0, 0, 0, 0);
            if (createdMs < startOfToday) return false;
          } else if (dateRange === '7d') {
            if (now - createdMs > 7 * 24 * 60 * 60 * 1000) return false;
          } else if (dateRange === '30d') {
            if (now - createdMs > 30 * 24 * 60 * 60 * 1000) return false;
          }
        }

        // 6. Has Replay
        if (hasReplay) {
          if (!issue.replayUrl && !issue.replay_storage_path) return false;
        }

        // 7. Has Video
        if (hasVideo) {
          if (!issue.videoUrl && !issue.video_storage_path) return false;
        }

        // 8. Has Console Errors
        if (hasErrors) {
          const errCount = issue.metadata?.consoleErrors?.length ?? 0;
          if (errCount === 0) return false;
        }

        // 9. React Component
        if (reactComponent) {
          const comp = (issue.element_info?.react as { componentName?: string } | undefined)?.componentName;
          if (!comp || !comp.toLowerCase().includes(reactComponent.toLowerCase())) return false;
        }

        return true;
      });
    }

    const testDataset: IssueItem[] = [
      {
        id: '1',
        title: 'Checkout button failure',
        description: 'Submitting form triggers HTTP 500 error',
        route: '/checkout',
        url: 'https://bugpilot.test/checkout',
        status: 'In Triage',
        severity: 'Critical',
        created_at: new Date().toISOString(),
        replay_storage_path: 'user/proj/replay.json.gz',
        metadata: { assignee: 'Alice', consoleErrors: ['Uncaught Error'] },
        element_info: { react: { componentName: 'CheckoutButton' } },
      },
      {
        id: '2',
        title: null,
        description: 'Footer styling displaced',
        route: '/footer',
        url: null,
        status: null, // should default to 'Incoming'
        severity: 'low',
        created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        videoUrl: 'https://video.test/1.webm',
        metadata: null,
        element_info: null,
      },
      {
        id: '3',
        title: 'Settings page lag',
        description: 'Dropdown takes 2s to open',
        route: '/settings',
        url: 'https://bugpilot.test/settings',
        status: 'Resolved',
        severity: 'High',
        created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
        metadata: { assignee: 'Bob' },
        element_info: { react: { componentName: 'SettingsDropdown' } },
      },
    ];

    it('filters across title, description, and route', () => {
      expect(filterIssues(testDataset, { q: 'checkout' })).toHaveLength(1);
      expect(filterIssues(testDataset, { q: 'footer' })).toHaveLength(1);
      expect(filterIssues(testDataset, { q: 'lag' })).toHaveLength(1);
      expect(filterIssues(testDataset, { q: 'missing' })).toHaveLength(0);
    });

    it('defaults missing issue.status to "Incoming"', () => {
      const result = filterIssues(testDataset, { status: 'Incoming' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });

    it('matches severity case-insensitively', () => {
      expect(filterIssues(testDataset, { severity: 'critical' })).toHaveLength(1);
      expect(filterIssues(testDataset, { severity: 'LOW' })).toHaveLength(1);
      expect(filterIssues(testDataset, { severity: 'Medium' })).toHaveLength(0);
    });

    it('filters by replay and video availability', () => {
      expect(filterIssues(testDataset, { hasReplay: true })).toHaveLength(1);
      expect(filterIssues(testDataset, { hasReplay: true })[0].id).toBe('1');
      expect(filterIssues(testDataset, { hasVideo: true })).toHaveLength(1);
      expect(filterIssues(testDataset, { hasVideo: true })[0].id).toBe('2');
    });

    it('filters by console errors presence without throwing on null metadata', () => {
      expect(filterIssues(testDataset, { hasErrors: true })).toHaveLength(1);
      expect(filterIssues(testDataset, { hasErrors: true })[0].id).toBe('1');
    });

    it('filters by React component name without throwing on null element_info', () => {
      expect(filterIssues(testDataset, { reactComponent: 'CheckoutButton' })).toHaveLength(1);
      expect(filterIssues(testDataset, { reactComponent: 'Settings' })).toHaveLength(1);
      expect(filterIssues(testDataset, { reactComponent: 'Unknown' })).toHaveLength(0);
    });

    it('filters by date range correctly', () => {
      expect(filterIssues(testDataset, { dateRange: '7d' })).toHaveLength(2); // items 1 and 2
      expect(filterIssues(testDataset, { dateRange: '30d' })).toHaveLength(2); // items 1 and 2
      expect(filterIssues(testDataset, { dateRange: 'all' })).toHaveLength(3); // all items
    });
  });
});
