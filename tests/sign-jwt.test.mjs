import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleSignJWT } from '../src/handlers/sign-jwt.mjs';
import { createVerify, createPublicKey } from 'node:crypto';

describe('signJWT handler', () => {
  it('returns error when payload is missing', async () => {
    const result = await handleSignJWT({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('returns error when payload is null', async () => {
    const result = await handleSignJWT({ payload: null });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('returns error when payload is a string', async () => {
    const result = await handleSignJWT({ payload: 'not an object' });
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Invalid params: payload must be a non-null object' },
    });
  });

  it('signs a JWT with RS256', async () => {
    const result = await handleSignJWT({
      payload: { sub: 'user123', aud: 'https://example.com' },
      options: {},
    });

    assert.ok(result.token);
    const parts = result.token.split('.');
    assert.equal(parts.length, 3);

    // Decode header
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.equal(header.alg, 'RS256');
    assert.equal(header.typ, 'JWT');

    // Decode payload
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    assert.equal(payload.sub, 'user123');
    assert.equal(payload.aud, 'https://example.com');
    assert.ok(payload.iat); // iat should be set
  });

  it('respects custom typ option', async () => {
    const result = await handleSignJWT({
      payload: { sub: 'user123' },
      options: { typ: 'secevent+jwt' },
    });

    const parts = result.token.split('.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    assert.equal(header.typ, 'secevent+jwt');
  });

  it('produces a valid three-part JWT', async () => {
    const result = await handleSignJWT({
      payload: { foo: 'bar' },
    });

    // Verify it's valid base64url in all three parts
    const parts = result.token.split('.');
    for (const part of parts) {
      assert.match(part, /^[A-Za-z0-9_-]+$/);
    }
  });
});
