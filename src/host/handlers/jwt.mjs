import { createSign, generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

function base64url(data) {
  const str = typeof data === 'string' ? data : Buffer.from(data).toString('base64');
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signJWT(params) {
  const { payload, options = {} } = params;

  if (!payload || typeof payload !== 'object') {
    return { error: { code: -32602, message: 'Invalid params: payload must be a non-null object' } };
  }

  const header = { alg: 'RS256', typ: options.typ || 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { iat: now, ...payload };

  const headerB64 = base64url(Buffer.from(JSON.stringify(header)).toString('base64'));
  const payloadB64 = base64url(Buffer.from(JSON.stringify(fullPayload)).toString('base64'));
  const signingInput = `${headerB64}.${payloadB64}`;

  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign(privateKey, 'base64'));

  return { jwt: `${signingInput}.${signature}` };
}
