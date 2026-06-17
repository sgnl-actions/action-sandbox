import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFetchHandler } from '../src/handlers/fetch.mjs';
import { createServer } from 'node:http';

let server;
let baseUrl;
let handleFetch;

describe('fetch handler (passthrough mode)', () => {
  before(async () => {
    handleFetch = createFetchHandler();

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
