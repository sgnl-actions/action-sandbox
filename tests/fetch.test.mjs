import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleFetch } from '../src/handlers/fetch.mjs';

describe('fetch handler', () => {
  it('returns error when url is missing', async () => {
    const result = await handleFetch({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: url' },
    });
  });

  it('makes a real GET request', async () => {
    const result = await handleFetch({
      url: 'https://httpbin.org/get',
      method: 'GET',
    });

    assert.equal(result.status, 200);
    assert.ok(result.headers);
    assert.ok(result.body); // base64 encoded

    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    assert.equal(body.url, 'https://httpbin.org/get');
  });

  it('makes a POST request with body', async () => {
    const payload = JSON.stringify({ hello: 'world' });
    const bodyB64 = Buffer.from(payload).toString('base64');

    const result = await handleFetch({
      url: 'https://httpbin.org/post',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyB64,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    assert.equal(body.json.hello, 'world');
  });

  it('returns non-200 status codes without throwing', async () => {
    const result = await handleFetch({
      url: 'https://httpbin.org/status/404',
      method: 'GET',
    });

    assert.equal(result.status, 404);
  });
});
