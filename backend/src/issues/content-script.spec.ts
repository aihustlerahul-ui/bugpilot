import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

describe('Content Script Error & WSOD Interception', () => {
  const contentCode = fs.readFileSync(path.resolve(__dirname, '../../../extension/content.js'), 'utf-8');

  function createMockEnvironment() {
    const windowListeners: Record<string, Function[]> = {};
    const chromeListeners: Function[] = [];
    const storageData: Record<string, any> = {};

    const mockBody: any = {
      tagName: 'BODY',
      id: '',
      classList: [],
      children: [],
      getAttribute: jest.fn().mockReturnValue(null),
      getBoundingClientRect: () => ({ width: 1024, height: 768, top: 0, left: 0 }),
      parentElement: null,
    };

    const mockDocEl: any = {
      tagName: 'HTML',
      id: '',
      classList: [],
      children: [mockBody],
      getAttribute: jest.fn().mockReturnValue(null),
      getBoundingClientRect: () => ({ width: 1024, height: 768, top: 0, left: 0 }),
      parentElement: null,
      appendChild: jest.fn(),
    };
    mockBody.parentElement = mockDocEl;

    const mockDocument: any = {
      body: mockBody,
      documentElement: mockDocEl,
      querySelector: jest.fn().mockReturnValue(null),
      querySelectorAll: jest.fn().mockImplementation((sel: string) => (sel && sel.startsWith('#') ? [{}] : [])),
      createElement: (tag: string) => ({
        tagName: tag.toUpperCase(),
        style: {},
        setAttribute: jest.fn(),
        appendChild: jest.fn(),
        addEventListener: jest.fn(),
        querySelector: jest.fn().mockReturnValue(null),
        querySelectorAll: jest.fn().mockReturnValue([]),
      }),
      cookie: '',
    };

    const mockConsole: any = {
      log: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const mockChrome: any = {
      runtime: {
        onMessage: {
          addListener: (fn: Function) => chromeListeners.push(fn),
        },
        sendMessage: jest.fn(),
      },
      storage: {
        local: {
          get: (keys: any, cb: Function) => cb(storageData),
          set: (obj: any, cb?: Function) => {
            Object.assign(storageData, obj);
            if (cb) cb();
          },
        },
        onChanged: {
          addListener: jest.fn(),
        },
      },
    };

    const mockWindow: any = {
      addEventListener: (evt: string, fn: Function) => {
        if (!windowListeners[evt]) windowListeners[evt] = [];
        windowListeners[evt].push(fn);
      },
      removeEventListener: jest.fn(),
      postMessage: jest.fn(),
      location: { href: 'https://example.com/app' },
      history: {
        pushState: jest.fn(),
        replaceState: jest.fn(),
      },
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1024,
      innerHeight: 768,
      getComputedStyle: () => ({}),
      navigator: { userAgent: 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' },
      CSS: {
        escape: (s: string) => s,
      },
    };

    const context = vm.createContext({
      window: mockWindow,
      document: mockDocument,
      console: mockConsole,
      chrome: mockChrome,
      history: mockWindow.history,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      setTimeout,
      clearTimeout,
    });

    return {
      context,
      mockWindow,
      mockDocument,
      mockConsole,
      mockChrome,
      windowListeners,
      storageData,
    };
  }

  it('captures console.log, info, warn, error up to 30 buffer items with level tags and sanitization', () => {
    const env = createMockEnvironment();
    vm.runInContext(contentCode, env.context);

    // Call console methods
    for (let i = 0; i < 35; i++) {
      if (i % 4 === 0) env.mockConsole.log(`User action step ${i} ?token=secret_${i}`);
      else if (i % 4 === 1) env.mockConsole.info(`App info event ${i}`);
      else if (i % 4 === 2) env.mockConsole.warn(`App warning ${i}`);
      else env.mockConsole.error(new Error(`Crash issue ${i}`));
    }

    const buffer = env.mockWindow.__qaConsoleBuffer;
    expect(buffer).toBeDefined();
    expect(buffer.length).toBe(30); // Capped at 30 items
    expect(buffer.some((entry: any) => entry.level === 'log')).toBe(true);
    expect(buffer.some((entry: any) => entry.level === 'info')).toBe(true);
    expect(buffer.some((entry: any) => entry.level === 'warn')).toBe(true);
    expect(buffer.some((entry: any) => entry.level === 'error')).toBe(true);

    // Ensure sanitization worked on console log
    const logEntry = buffer.find((entry: any) => entry.level === 'log');
    expect(logEntry.message).toContain('[REDACTED]');
    expect(logEntry.message).not.toContain('secret_');

    // Test undefined, null, circular reference formatting
    const circ: any = { a: 1 };
    circ.self = circ;
    env.mockConsole.log('status:', undefined, null, circ);
    const lastEntry = buffer[buffer.length - 1];
    expect(lastEntry.message).toContain('status: undefined null');
  });

  it('captures window unhandled runtime errors with stack trace and sanitization', () => {
    const env = createMockEnvironment();
    vm.runInContext(contentCode, env.context);

    expect(env.windowListeners['error']).toBeDefined();
    const errorHandler = env.windowListeners['error'][0];

    errorHandler({
      message: 'Uncaught TypeError: Cannot read property of undefined',
      filename: 'https://cdn.example.com/bundle.js',
      lineno: 10,
      colno: 25,
      error: {
        stack: 'TypeError: Cannot read property\n    at init (bundle.js:10:25?token=super-secret)',
      },
    });

    const buffer = env.mockWindow.__qaConsoleBuffer;
    const errorEntry = buffer.find((e: any) => e.message.includes('https://cdn.example.com/bundle.js:10:25'));
    expect(errorEntry).toBeDefined();
    expect(errorEntry.level).toBe('error');
    expect(errorEntry.message).not.toContain('super-secret');
    expect(errorEntry.message).toContain('[REDACTED]');
  });

  it('captures window unhandled Promise rejections with message and stack', () => {
    const env = createMockEnvironment();
    vm.runInContext(contentCode, env.context);

    expect(env.windowListeners['unhandledrejection']).toBeDefined();
    const rejectionHandler = env.windowListeners['unhandledrejection'][0];

    const err = new Error('Async network request failed authorization=Bearer secret');
    err.stack = 'Error: Async network request failed\n    at fetchCall (api.js:45:12)';
    rejectionHandler({
      reason: err,
    });

    const buffer = env.mockWindow.__qaConsoleBuffer;
    const rejectionEntry = buffer.find((e: any) => e.message.includes('Unhandled Promise Rejection'));
    expect(rejectionEntry).toBeDefined();
    expect(rejectionEntry.level).toBe('error');
    expect(rejectionEntry.message).toContain('Async network request failed');
  });

  it('handles BUGPILOT_CONSOLE_EVENT from MAIN world network interceptor', () => {
    const env = createMockEnvironment();
    vm.runInContext(contentCode, env.context);

    expect(env.windowListeners['message']).toBeDefined();
    const messageHandler = env.windowListeners['message'].find((fn: any) => fn.toString().includes('BUGPILOT_CONSOLE_EVENT') || fn.toString().includes('BUGPILOT_NETWORK_EVENT'));

    expect(messageHandler).toBeDefined();

    messageHandler!({
      source: env.mockWindow,
      data: {
        type: 'BUGPILOT_CONSOLE_EVENT',
        payload: {
          level: 'error',
          message: 'Uncaught ReferenceError: window.unknownVar is not defined ?token=secret123',
          timestamp: new Date().toISOString(),
        },
      },
    });

    const buffer = env.mockWindow.__qaConsoleBuffer;
    const msgEntry = buffer.find((e: any) => e.message.includes('ReferenceError: window.unknownVar'));
    expect(msgEntry).toBeDefined();
    expect(msgEntry.level).toBe('error');
    expect(msgEntry.message).toContain('[REDACTED]');
    expect(msgEntry.message).not.toContain('secret123');
  });

  it('returns clean WSOD note and safe selectors for document.body, documentElement and empty roots', () => {
    const env = createMockEnvironment();
    vm.runInContext(contentCode, env.context);

    const captureElementData = env.mockWindow.__qaCaptureElementData;
    expect(captureElementData).toBeDefined();

    // 1. Test document.body
    const bodyData = captureElementData(env.mockDocument.body);
    expect(bodyData).toBeDefined();
    expect(bodyData.note).toBe('Full viewport / empty root capture (potential WSOD or unmounted state)');
    expect(bodyData.cssSelector).toBe('body');
    expect(bodyData.xpath).toBe('/html/body');

    // 2. Test document.documentElement
    const docElData = captureElementData(env.mockDocument.documentElement);
    expect(docElData).toBeDefined();
    expect(docElData.note).toBe('Full viewport / empty root capture (potential WSOD or unmounted state)');
    expect(docElData.cssSelector).toBe('html');
    expect(docElData.xpath).toBe('/html');

    // 3. Test empty root node (<div id="root"></div>)
    const emptyRootNode: any = {
      tagName: 'DIV',
      id: 'root',
      classList: [],
      children: [],
      textContent: '',
      getAttribute: jest.fn().mockReturnValue(null),
      getBoundingClientRect: () => ({ width: 1024, height: 768, top: 0, left: 0 }),
      parentElement: env.mockDocument.body,
    };

    const rootData = captureElementData(emptyRootNode);
    expect(rootData).toBeDefined();
    expect(rootData.note).toBe('Full viewport / empty root capture (potential WSOD or unmounted state)');
    expect(rootData.cssSelector).toBe('#root');

    // 4. Test regular non-empty element
    const buttonNode: any = {
      tagName: 'BUTTON',
      id: 'submit-btn',
      classList: ['btn', 'btn-primary'],
      children: [{ tagName: 'SPAN' }],
      textContent: 'Submit Form',
      getAttribute: (attr: string) => null,
      getBoundingClientRect: () => ({ width: 120, height: 40, top: 100, left: 50 }),
      parentElement: env.mockDocument.body,
    };

    const buttonData = captureElementData(buttonNode);
    expect(buttonData).toBeDefined();
    expect(buttonData.note).toBeUndefined();
    expect(buttonData.cssSelector).toBe('#submit-btn');

    // 5. Test element with data-testid and no id
    const testIdNode: any = {
      tagName: 'BUTTON',
      id: '',
      classList: ['btn', 'btn-primary'],
      children: [{ tagName: 'SPAN' }],
      textContent: 'Custom Action',
      getAttribute: (attr: string) => (attr === 'data-testid' ? 'action-button' : null),
      getBoundingClientRect: () => ({ width: 120, height: 40, top: 100, left: 50 }),
      parentElement: env.mockDocument.body,
    };

    const testIdData = captureElementData(testIdNode);
    expect(testIdData).toBeDefined();
    expect(testIdData.note).toBeUndefined();
    expect(testIdData.cssSelector).toBe('[data-testid="action-button"]');
  });
});
