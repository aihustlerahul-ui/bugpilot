// Test network-interceptor.js behavior in a simulated DOM environment
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function runInterceptorTests() {
  const code = fs.readFileSync(path.resolve(__dirname, '../../extension/network-interceptor.js'), 'utf-8');

  const postedMessages = [];
  const fakeWindow = {
    postMessage: (data) => {
      postedMessages.push(data);
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // Mock fetch
  let mockFetchCalledWith = null;
  fakeWindow.fetch = function(url, init) {
    mockFetchCalledWith = { url, init };
    return Promise.resolve({
      status: 200,
      statusText: 'OK',
      headers: new Map([
        ['content-type', 'application/json'],
        ['authorization', 'Bearer secret-jwt-token'],
        ['set-cookie', 'session=12345']
      ]),
      clone: function() {
        return {
          text: () => Promise.resolve(JSON.stringify({
            username: 'alice',
            password: 'superSecretPassword',
            cardnumber: '4111 1111 1111 1234',
            data: 'clean'
          }))
        };
      }
    });
  };

  // Mock XMLHttpRequest
  class FakeXHR {
    constructor() {
      this.headers = {};
      this.listeners = {};
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k, v) {
      this.headers[k] = v;
    }
    addEventListener(evt, fn) {
      this.listeners[evt] = fn;
    }
    send(body) {
      this.sentBody = body;
      this.status = 201;
      this.statusText = 'Created';
      this.responseText = JSON.stringify({ token: 'secret-token-value', result: 'ok' });
      this.responseType = 'text';
      if (this.listeners['loadend']) {
        this.listeners['loadend']();
      }
    }
    getAllResponseHeaders() {
      return 'content-type: application/json\r\nset-cookie: user=alice\r\n';
    }
  }
  fakeWindow.XMLHttpRequest = FakeXHR;

  const context = vm.createContext({
    window: fakeWindow,
    Date: Date,
    JSON: JSON,
    Math: Math,
    String: String,
    Array: Array,
    Object: Object,
    RegExp: RegExp,
    Promise: Promise,
    Map: Map,
    Headers: Map,
  });

  vm.runInContext(code, context);

  // Test 1: Fetch interception
  return fakeWindow.fetch('https://api.example.com/login?token=sensitive-query-token', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer my-secret',
      'Content-Type': 'application/json',
      'X-API-KEY': 'key-123'
    },
    body: JSON.stringify({
      email: 'test@example.com',
      password: 'mypassword123',
      credit_card: '4111-2222-3333-4444'
    })
  }).then(() => {
    // Wait microtasks for async clone.text()
    return new Promise(resolve => setTimeout(resolve, 50));
  }).then(() => {
    console.log('Total posted messages:', postedMessages.length);
    const fetchMsg = postedMessages.find(m => m.payload && m.payload.initiator === 'fetch');
    if (!fetchMsg) throw new Error('Fetch message not captured');
    const p = fetchMsg.payload;

    // Verify sanitization
    if (p.url.includes('sensitive-query-token')) throw new Error('URL token not redacted');
    if (p.requestHeaders['Authorization'] !== '[REDACTED]') throw new Error('Authorization header not redacted');
    if (p.requestHeaders['X-API-KEY'] !== '[REDACTED]') throw new Error('X-API-KEY header not redacted');
    
    const reqBodyParsed = JSON.parse(p.requestBody);
    if (reqBodyParsed.password !== '[REDACTED]') throw new Error('Password in body not redacted: ' + reqBodyParsed.password);
    if (reqBodyParsed.credit_card !== '[REDACTED]') throw new Error('Credit card in body not redacted');
    
    const resBodyParsed = JSON.parse(p.responseBody);
    if (resBodyParsed.password !== '[REDACTED]') throw new Error('Password in response body not redacted');
    if (p.responseHeaders['set-cookie'] !== '[REDACTED]') throw new Error('set-cookie in response not redacted');

    // Test 2: XHR interception
    const xhr = new fakeWindow.XMLHttpRequest();
    xhr.open('POST', 'https://api.example.com/data');
    xhr.setRequestHeader('Authorization', 'Bearer secret-xhr');
    xhr.setRequestHeader('X-Custom', 'hello');
    xhr.send(JSON.stringify({ secret: 'xhr-secret', other: 'test' }));

    const xhrMsg = postedMessages.find(m => m.payload && m.payload.initiator === 'xhr');
    if (!xhrMsg) throw new Error('XHR message not captured');
    const xp = xhrMsg.payload;
    if (xp.requestHeaders['Authorization'] !== '[REDACTED]') throw new Error('XHR Authorization not redacted');
    const xhrReqParsed = JSON.parse(xp.requestBody);
    if (xhrReqParsed.secret !== '[REDACTED]') throw new Error('XHR request body secret not redacted');
    const xhrResParsed = JSON.parse(xp.responseBody);
    if (xhrResParsed.token !== '[REDACTED]') throw new Error('XHR response body token not redacted');

    console.log('ALL INTERCEPTOR TESTS PASSED PERFECTLY!');
  });
}

runInterceptorTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
