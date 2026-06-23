import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupFetchFixtures, cleanupFetchFixtures, handleFetch } from '../src/host/handlers/fetch.mjs';

describe('http handler', () => {
  beforeEach(() => {
    cleanupFetchFixtures();
  });

  it('returns error when hostname is missing', () => {
    const result = handleFetch({ method: 'GET' });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: url' },
    });
  });

  it('constructs URL from parts and matches fixture', () => {
    setupFetchFixtures([
      {
        request: { method: 'POST', url: 'https://api.example.com/v1/users' },
        response: { status: 201, headers: {}, body: '{"id":"123"}' },
      },
    ]);

    const result = handleFetch({
      url: 'https://api.example.com/v1/users',
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

    const result = handleFetch({ url: 'https://example.com/', method: 'GET' });
    assert.equal(result.status, 200);
  });

  it('handles http protocol', () => {
    setupFetchFixtures([
      {
        request: { method: 'GET', url: 'http://localhost:8080/health' },
        response: { status: 200, headers: {}, body: 'healthy' },
      },
    ]);

    const result = handleFetch({
      url: 'http://localhost:8080/health',
      method: 'GET',
    });

    assert.equal(result.status, 200);
  });

  it('returns no fixture matched error', () => {
    setupFetchFixtures([]);

    const result = handleFetch({
      url: 'https://unknown.example.com/missing',
      method: 'GET',
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

    const r1 = handleFetch({ url: 'https://iam.example.com/', method: 'POST' });
    assert.equal(r1.status, 401);

    // Should still match on retry
    const r2 = handleFetch({ url: 'https://iam.example.com/', method: 'POST' });
    assert.equal(r2.status, 401);
  });
});
