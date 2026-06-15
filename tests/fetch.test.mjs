import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler } from '../src/handlers/fetch.mjs';
import { createServer } from 'node:http';

let server;
let baseUrl;
let handleFetch;

describe('fetch handler (passthrough mode)', () => {
  before(async () => {
    handleFetch = createFetchHandler(null);

    server = createServer((req, res) => {
      if (req.url === '/status/404') {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }

      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const response = JSON.stringify({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: body || undefined,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(response);
      });
    });

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it('returns error when url is missing', async () => {
    const result = await handleFetch({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: url' },
    });
  });

  it('makes a GET request', async () => {
    const result = await handleFetch({
      url: `${baseUrl}/get`,
      method: 'GET',
    });

    assert.equal(result.status, 200);
    assert.ok(result.headers);
    assert.ok(result.body);

    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    assert.equal(body.method, 'GET');
    assert.equal(body.url, '/get');
  });

  it('makes a POST request with body', async () => {
    const payload = JSON.stringify({ hello: 'world' });
    const bodyB64 = Buffer.from(payload).toString('base64');

    const result = await handleFetch({
      url: `${baseUrl}/post`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyB64,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    assert.equal(body.method, 'POST');
    assert.equal(body.body, payload);
  });

  it('returns non-200 status codes without throwing', async () => {
    const result = await handleFetch({
      url: `${baseUrl}/status/404`,
      method: 'GET',
    });

    assert.equal(result.status, 404);
  });
});

describe('fetch handler (fixture mode)', () => {
  it('returns fixture response for matching request', async () => {
    const fixtures = [
      {
        request: { method: 'GET', url: 'https://api.example.com/users' },
        response: { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"users":[]}' },
      },
    ];
    const handler = createFetchHandler(fixtures);

    const result = await handler({ url: 'https://api.example.com/users', method: 'GET' });

    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'application/json');
    const body = Buffer.from(result.body, 'base64').toString();
    assert.equal(body, '{"users":[]}');
  });

  it('consumes fixtures in FIFO order', async () => {
    const fixtures = [
      {
        request: { method: 'GET', url: 'https://api.example.com/token' },
        response: { statusCode: 200, body: 'first' },
      },
      {
        request: { method: 'GET', url: 'https://api.example.com/token' },
        response: { statusCode: 200, body: 'second' },
      },
    ];
    const handler = createFetchHandler(fixtures);

    const r1 = await handler({ url: 'https://api.example.com/token', method: 'GET' });
    assert.equal(Buffer.from(r1.body, 'base64').toString(), 'first');

    const r2 = await handler({ url: 'https://api.example.com/token', method: 'GET' });
    assert.equal(Buffer.from(r2.body, 'base64').toString(), 'second');
  });

  it('returns error when no fixture matches (strict mode)', async () => {
    const fixtures = [
      {
        request: { method: 'POST', url: 'https://api.example.com/data' },
        response: { statusCode: 201, body: 'created' },
      },
    ];
    const handler = createFetchHandler(fixtures);

    const result = await handler({ url: 'https://api.example.com/other', method: 'GET' });
    assert.deepEqual(result, {
      error: { code: -32001, message: 'No fixture matched: GET https://api.example.com/other' },
    });
  });

  it('returns error after fixture is consumed', async () => {
    const fixtures = [
      {
        request: { method: 'GET', url: 'https://api.example.com/once' },
        response: { statusCode: 200, body: 'ok' },
      },
    ];
    const handler = createFetchHandler(fixtures);

    // First call succeeds
    const r1 = await handler({ url: 'https://api.example.com/once', method: 'GET' });
    assert.equal(r1.status, 200);

    // Second call fails — fixture consumed
    const r2 = await handler({ url: 'https://api.example.com/once', method: 'GET' });
    assert.ok(r2.error);
    assert.equal(r2.error.code, -32001);
  });

  it('simulates network error', async () => {
    const fixtures = [
      {
        request: { method: 'GET', url: 'https://api.example.com/fail' },
        response: { networkError: true },
      },
    ];
    const handler = createFetchHandler(fixtures);

    const result = await handler({ url: 'https://api.example.com/fail', method: 'GET' });
    assert.deepEqual(result, {
      error: { code: -32002, message: 'Network error: connection refused' },
    });
  });

  it('handles empty body in fixture', async () => {
    const fixtures = [
      {
        request: { method: 'DELETE', url: 'https://api.example.com/item/1' },
        response: { statusCode: 204, headers: {} },
      },
    ];
    const handler = createFetchHandler(fixtures);

    const result = await handler({ url: 'https://api.example.com/item/1', method: 'DELETE' });
    assert.equal(result.status, 204);
    assert.equal(Buffer.from(result.body, 'base64').toString(), '');
  });
});
