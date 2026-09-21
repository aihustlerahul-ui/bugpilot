import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

describe('MAIN World Network Interceptor', () => {
  it('intercepts fetch with sanitization, cloning, and emits BUGPILOT_NETWORK_EVENT', async () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    fakeWindow.fetch = function (url: string, init: any) {
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: new Map([
          ['content-type', 'application/json'],
          ['authorization', 'Bearer secret-jwt-token'],
          ['set-cookie', 'session=12345'],
          ['x-csrf-token', 'csrf-token-secret'],
        ]),
        clone: function () {
          return {
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  username: 'alice',
                  password: 'superSecretPassword',
                  cardnumber: '4111 1111 1111 1234',
                  access_token: 'secret-token-xyz',
                  data: 'clean',
                }),
              ),
          };
        },
      });
    };

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    await fakeWindow.fetch('https://api.example.com/login?token=sensitive-query-token', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer my-secret',
        'Content-Type': 'application/json',
        'X-API-KEY': 'key-123',
        'X-CSRF-TOKEN': 'token-csrf',
      },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'mypassword123',
        credit_card: '4111-2222-3333-4444',
        client_secret: 'topsecret123',
      }),
    });

    // Wait for async clone.text()
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postedMessages.length).toBeGreaterThanOrEqual(1);
    const fetchMsg = postedMessages.find((m) => m.payload && m.payload.initiator === 'fetch');
    expect(fetchMsg).toBeDefined();

    const p = fetchMsg.payload;
    expect(p.url).not.toContain('sensitive-query-token');
    expect(p.requestHeaders['Authorization']).toBe('[REDACTED]');
    expect(p.requestHeaders['X-API-KEY']).toBe('[REDACTED]');
    expect(p.requestHeaders['X-CSRF-TOKEN']).toBe('[REDACTED]');

    const reqBodyParsed = JSON.parse(p.requestBody);
    expect(reqBodyParsed.password).toBe('[REDACTED]');
    expect(reqBodyParsed.credit_card).toBe('[REDACTED]');
    expect(reqBodyParsed.client_secret).toBe('[REDACTED]');

    const resBodyParsed = JSON.parse(p.responseBody);
    expect(resBodyParsed.password).toBe('[REDACTED]');
    expect(resBodyParsed.cardnumber).toBe('[REDACTED]');
    expect(resBodyParsed.access_token).toBe('[REDACTED]');
    expect(p.responseHeaders['set-cookie']).toBe('[REDACTED]');
    expect(p.responseHeaders['x-csrf-token']).toBe('[REDACTED]');
  });

  it('intercepts fetch failures / network errors gracefully', async () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    fakeWindow.fetch = function () {
      return Promise.reject(new Error('Failed to fetch (net::ERR_CONNECTION_REFUSED)'));
    };

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    await expect(fakeWindow.fetch('https://broken.api.com/status')).rejects.toThrow();

    const fetchMsg = postedMessages.find((m) => m.payload && m.payload.url === 'https://broken.api.com/status');
    expect(fetchMsg).toBeDefined();
    expect(fetchMsg.payload.status).toBe('failed');
    expect(fetchMsg.payload.error).toContain('ERR_CONNECTION_REFUSED');
  });

  it('intercepts XMLHttpRequest with headers, payload, and sanitization', async () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    class FakeXHR {
      headers: Record<string, string> = {};
      listeners: Record<string, Function[]> = {};
      method: string = '';
      url: string = '';
      status: number = 0;
      statusText: string = '';
      responseText: string = '';
      responseType: string = '';

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      addEventListener(evt: string, fn: Function) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
      }
      send(body: any) {
        this.status = 201;
        this.statusText = 'Created';
        this.responseText = JSON.stringify({ token: 'secret-token-value', result: 'ok' });
        this.responseType = 'text';
        if (this.listeners['loadend']) {
          this.listeners['loadend'].forEach((cb) => cb());
        }
      }
      getAllResponseHeaders() {
        return 'content-type: application/json\r\nset-cookie: user=alice\r\n';
      }
    }

    fakeWindow.XMLHttpRequest = FakeXHR;

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open('POST', 'https://api.example.com/data');
    xhr.setRequestHeader('Authorization', 'Bearer secret-xhr');
    xhr.setRequestHeader('X-Custom', 'hello');
    xhr.send(JSON.stringify({ secret: 'xhr-secret', other: 'test' }));

    const xhrMsg = postedMessages.find((m) => m.payload && m.payload.initiator === 'xhr');
    expect(xhrMsg).toBeDefined();

    const xp = xhrMsg.payload;
    expect(xp.requestHeaders['Authorization']).toBe('[REDACTED]');
    expect(xp.requestHeaders['X-Custom']).toBe('hello');

    const xhrReqParsed = JSON.parse(xp.requestBody);
    expect(xhrReqParsed.secret).toBe('[REDACTED]');
    expect(xhrReqParsed.other).toBe('test');

    const xhrResParsed = JSON.parse(xp.responseBody);
    expect(xhrResParsed.token).toBe('[REDACTED]');
    expect(xhrResParsed.result).toBe('ok');
    expect(xp.responseHeaders['set-cookie']).toBe('[REDACTED]');
  });

  it('supports reused XMLHttpRequest instances across multiple requests', async () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    class FakeXHR {
      headers: Record<string, string> = {};
      listeners: Record<string, Function[]> = {};
      method: string = '';
      url: string = '';
      status: number = 0;
      statusText: string = '';
      responseText: string = '';
      responseType: string = '';

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
        this.headers = {};
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      addEventListener(evt: string, fn: Function) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
      }
      send(body: any) {
        this.status = 200;
        this.statusText = 'OK';
        this.responseText = 'response-' + this.url;
        this.responseType = 'text';
        if (this.listeners['loadend']) {
          this.listeners['loadend'].forEach((cb) => cb());
        }
      }
      getAllResponseHeaders() {
        return 'content-type: text/plain\r\n';
      }
    }

    fakeWindow.XMLHttpRequest = FakeXHR;

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    const xhr = new fakeWindow.XMLHttpRequest();
    // First request
    xhr.open('GET', 'https://api.example.com/item1');
    xhr.send();

    // Reuse the same instance for a second request
    xhr.open('GET', 'https://api.example.com/item2');
    xhr.send();

    const item1 = postedMessages.find((m) => m.payload?.url === 'https://api.example.com/item1');
    const item2 = postedMessages.find((m) => m.payload?.url === 'https://api.example.com/item2');

    expect(item1).toBeDefined();
    expect(item2).toBeDefined();
  });

  it('caps large payloads to 50KB with truncation notice', async () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    const bigString = 'X'.repeat(70 * 1024); // 70KB
    fakeWindow.fetch = function () {
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'text/plain']]),
        clone: () => ({
          text: () => Promise.resolve(bigString),
        }),
      });
    };

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    await fakeWindow.fetch('https://api.example.com/big');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const msg = postedMessages.find((m) => m.payload?.url === 'https://api.example.com/big');
    expect(msg).toBeDefined();
    expect(msg.payload.responseBody).toContain('[TRUNCATED - MAX 50KB]');
    expect(msg.payload.responseBody.length).toBeLessThan(60 * 1024);
  });

  it('captures uncaught runtime errors and relays BUGPILOT_CONSOLE_EVENT', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const eventListeners: Record<string, Function[]> = {};
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: (evt: string, fn: Function) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(fn);
      },
      removeEventListener: jest.fn(),
    };

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    expect(eventListeners['error']).toBeDefined();
    expect(eventListeners['error'].length).toBeGreaterThanOrEqual(1);

    // Trigger an error event
    const errorFn = eventListeners['error'][0];
    errorFn({
      message: 'Uncaught TypeError: Cannot read properties of undefined (reading user_secret_password: secret123)',
      filename: 'https://app.example.com/main.js',
      lineno: 42,
      colno: 10,
      error: {
        stack: 'TypeError: Cannot read properties\n    at main.js:42:10?token=super-secret-token',
      },
    });

    const consoleMsg = postedMessages.find((m) => m.type === 'BUGPILOT_CONSOLE_EVENT');
    expect(consoleMsg).toBeDefined();
    expect(consoleMsg.payload.level).toBe('error');
    expect(consoleMsg.payload.message).toContain('main.js:42:10');
    expect(consoleMsg.payload.message).not.toContain('super-secret-token');
    expect(consoleMsg.payload.message).toContain('[REDACTED]');
  });

  it('captures unhandled promise rejections and relays BUGPILOT_CONSOLE_EVENT', () => {
    const code = fs.readFileSync(path.resolve(__dirname, '../../../extension/network-interceptor.js'), 'utf-8');

    const postedMessages: any[] = [];
    const eventListeners: Record<string, Function[]> = {};
    const fakeWindow: any = {
      postMessage: (data: any) => {
        postedMessages.push(data);
      },
      addEventListener: (evt: string, fn: Function) => {
        if (!eventListeners[evt]) eventListeners[evt] = [];
        eventListeners[evt].push(fn);
      },
      removeEventListener: jest.fn(),
    };

    const context = vm.createContext({
      window: fakeWindow,
      Date,
      JSON,
      Math,
      String,
      Array,
      Object,
      RegExp,
      Promise,
      Map,
      Headers: Map,
    });

    vm.runInContext(code, context);

    expect(eventListeners['unhandledrejection']).toBeDefined();
    expect(eventListeners['unhandledrejection'].length).toBeGreaterThanOrEqual(1);

    // Trigger an unhandled rejection event
    const rejectionFn = eventListeners['unhandledrejection'][0];
    const testErr = new Error('Database connection failed with credentials auth=supersecret');
    testErr.stack = 'Error: Database connection failed\n    at db.js:100:5';
    rejectionFn({
      reason: testErr,
    });

    const consoleMsg = postedMessages.find((m) => m.type === 'BUGPILOT_CONSOLE_EVENT');
    expect(consoleMsg).toBeDefined();
    expect(consoleMsg.payload.level).toBe('error');
    expect(consoleMsg.payload.message).toContain('Unhandled Promise Rejection');
    expect(consoleMsg.payload.message).toContain('Database connection failed');
  });
});
