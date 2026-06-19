import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupFetchFixtures, cleanupFetchFixtures } from '../src/host/handlers/fetch.mjs';
import { handleHttp } from '../src/host/handlers/http.mjs';

describe('http handler', () => {
  beforeEach(() => {
    cleanupFetchFixtures();
  });

  it('returns error when hostname is missing', () => {
    const result = handleHttp({ method: 'GET', path: '/' });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: hostname' },
    });
  });

  it('constructs URL from parts and matches fixture', () => {
    setupFetchFixtures([
      {
        request: { method: 'POST', url: 'https://api.example.com/v1/users' },
        response: { status: 201, headers: {}, body: '{"id":"123"}' },
      },
    ]);

    const result = handleHttp({
      protocol: 'https:',
      hostname: 'api.example.com',
      path: '/v1/users',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"name":"test"}').toString('base64'),
    });

    assert.equal(result.status, 201);
    const body = JSON.parse(Buffer.from(result.body, 'base64').toString());
    assert.equal(body.id, '123');
  });

  it('defaults protocol to https', () => {
    setupFetchFixtures([
      {
        request: { method: 'GET', url: 'https://example.com/' },
        response: { status: 200, headers: {}, body: 'ok' },
      },
    ]);

    const result = handleHttp({ hostname: 'example.com', path: '/' });
    assert.equal(result.status, 200);
  });

  it('handles http protocol', () => {
    setupFetchFixtures([
      {
        request: { method: 'GET', url: 'http://localhost:8080/health' },
        response: { status: 200, headers: {}, body: 'healthy' },
      },
    ]);

    const result = handleHttp({
      protocol: 'http:',
      hostname: 'localhost',
      port: 8080,
      path: '/health',
    });

    assert.equal(result.status, 200);
  });

  it('returns no fixture matched error', () => {
    setupFetchFixtures([]);

    const result = handleHttp({
      hostname: 'unknown.example.com',
      path: '/missing',
    });

    assert.ok(result.error);
    assert.match(result.error.message, /No fixture matched/);
  });

  it('persists error responses for retries', () => {
    setupFetchFixtures([
      {
        request: { method: 'POST', url: 'https://iam.example.com/' },
        response: { status: 401, headers: {}, body: 'unauthorized' },
      },
    ]);

    const r1 = handleHttp({ hostname: 'iam.example.com', path: '/', method: 'POST' });
    assert.equal(r1.status, 401);

    // Should still match on retry
    const r2 = handleHttp({ hostname: 'iam.example.com', path: '/', method: 'POST' });
    assert.equal(r2.status, 401);
  });
});
