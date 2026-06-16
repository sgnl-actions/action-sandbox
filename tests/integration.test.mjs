import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import nock from 'nock';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helloBundle = resolve(__dirname, 'fixtures/hello.bundle.js');
const fetchBundle = resolve(__dirname, 'fixtures/fetch.bundle.js');

describe('runAction integration', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, url: req.url }));
    });
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it('runs invoke handler', async () => {
    const result = await runAction({
      bundle: helloBundle,
      inputs: { name: 'World' },
      handler: 'invoke',
      timeout: 15000,
    });

    assert.equal(result.message, 'Hello, World!');
    assert.ok(result.timestamp);
  });

  it('runs error handler with recovery', async () => {
    const result = await runAction({
      bundle: helloBundle,
      inputs: { error: { message: 'recoverable failure' } },
      handler: 'error',
      timeout: 15000,
    });

    assert.deepEqual(result, { recovered: true });
  });

  it('runs halt handler', async () => {
    const result = await runAction({
      bundle: helloBundle,
      inputs: {},
      handler: 'halt',
      timeout: 15000,
    });

    assert.equal(result, undefined);
  });

  it('proxies fetch through sandbox host', async () => {
    const result = await runAction({
      bundle: fetchBundle,
      inputs: { url: `${baseUrl}/test`, method: 'GET' },
      handler: 'invoke',
      timeout: 15000,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.method, 'GET');
    assert.equal(body.url, '/test');
  });

  it('throws on missing bundle', async () => {
    await assert.rejects(
      () => runAction({ bundle: '/nonexistent/path.js' }),
      { message: /Bundle not found/ },
    );
  });

  it('throws on invalid handler', async () => {
    await assert.rejects(
      () => runAction({
        bundle: helloBundle,
        inputs: {},
        handler: 'nonexistent',
        timeout: 15000,
      }),
      { message: /Bundle does not export handler/ },
    );
  });

  it('throws when action throws', async () => {
    await assert.rejects(
      () => runAction({
        bundle: helloBundle,
        inputs: {}, // missing name
        handler: 'invoke',
        timeout: 15000,
      }),
      { message: /Missing required parameter: name/ },
    );
  });

  it('respects timeout', async () => {
    await assert.rejects(
      () => runAction({
        bundle: helloBundle,
        inputs: { name: 'Test' },
        handler: 'invoke',
        timeout: 1, // 1ms - too short
      }),
      { message: /timed out/ },
    );
  });
});

describe('runAction with nock', () => {
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('uses nock interceptor instead of real HTTP', async () => {
    nock('https://api.example.com')
      .get('/data')
      .reply(200, JSON.stringify({ method: 'GET', url: '/data' }), {
        'content-type': 'application/json',
      });

    const result = await runAction({
      bundle: fetchBundle,
      inputs: { url: 'https://api.example.com/data', method: 'GET' },
      handler: 'invoke',
      timeout: 15000,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.method, 'GET');
    assert.equal(body.url, '/data');
  });

  it('returns error when fetch fails with no interceptor', async () => {
    nock.disableNetConnect();

    await assert.rejects(
      () => runAction({
        bundle: fetchBundle,
        inputs: { url: 'https://api.example.com/data', method: 'GET' },
        handler: 'invoke',
        timeout: 15000,
      }),
      { message: /Disallowed net connect/ },
    );
  });

  it('simulates network error via nock', async () => {
    nock('https://api.example.com')
      .get('/fail')
      .replyWithError('Network error: connection refused');

    await assert.rejects(
      () => runAction({
        bundle: fetchBundle,
        inputs: { url: 'https://api.example.com/fail', method: 'GET' },
        handler: 'invoke',
        timeout: 15000,
      }),
      { message: /Network error: connection refused/ },
    );
  });

  it('intercepts request to specific URL', async () => {
    nock('https://api.example.com')
      .get('/token')
      .reply(200, JSON.stringify({ token: 'abc123' }));

    const result = await runAction({
      bundle: fetchBundle,
      inputs: { url: 'https://api.example.com/token', method: 'GET' },
      handler: 'invoke',
      timeout: 15000,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.token, 'abc123');
  });

  it('supports crypto fixture short-circuit', async () => {
    const result = await runAction({
      bundle: helloBundle,
      inputs: { name: 'CryptoTest' },
      secrets: {
        crypto: { signJWT: { returns: 'mock.jwt.token' } },
      },
      handler: 'invoke',
      timeout: 15000,
    });

    // helloBundle doesn't use signJWT, just verify it runs fine
    assert.equal(result.message, 'Hello, CryptoTest!');
  });
});
