import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signJWT } from '../src/host/handlers/jwt.mjs';

describe('signJWT handler', () => {
  it('returns error when payload is missing', () => {
    const result = signJWT({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('returns error when payload is null', () => {
    const result = signJWT({ payload: null });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('returns error when payload is a string', () => {
    const result = signJWT({ payload: 'not an object' });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('signs a JWT with RS256', () => {
    const result = signJWT({
      payload: { sub: 'user123', aud: 'https://example.com' },
      options: {},
    });

    assert.ok(result.jwt);
    const parts = result.jwt.split('.');
    assert.equal(parts.length, 3);

    // Decode header
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.equal(header.alg, 'RS256');
    assert.equal(header.typ, 'JWT');

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assert.equal(payload.sub, 'user123');
    assert.equal(payload.aud, 'https://example.com');
    assert.ok(payload.iat);
  });

  it('respects custom typ option', () => {
    const result = signJWT({
      payload: { sub: 'user123' },
      options: { typ: 'secevent+jwt' },
    });

    const parts = result.jwt.split('.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.equal(header.typ, 'secevent+jwt');
  });

  it('produces a valid three-part JWT with base64url encoding', () => {
    const result = signJWT({ payload: { foo: 'bar' } });

    const parts = result.jwt.split('.');
    assert.equal(parts.length, 3);
    for (const part of parts) {
      assert.match(part, /^[A-Za-z0-9_-]+$/);
    }
  });
});
