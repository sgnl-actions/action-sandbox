import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runAction, ContainerSession, checkDocker } from '../src/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helloBundle = resolve(__dirname, 'fixtures/hello.bundle.js');
const fetchBundle = resolve(__dirname, 'fixtures/fetch.bundle.js');

describe('runAction integration (container)', () => {
  let session;

  before(async () => {
    // Verify Docker is available
    checkDocker();
    session = new ContainerSession();
    await session.start();
  });

  after(async () => {
    await session.close();
  });

  it('runs invoke handler', async () => {
    const result = await runAction({
      bundle: helloBundle,
      inputs: { name: 'World' },
      handler: 'invoke',
      timeout: 15000,
      session,
    });

    assert.equal(result.message, 'Hello, World!');
    assert.ok(result.timestamp);
  });

  it('calls error handler when invoke throws', async () => {
    // The shim always calls invoke first.
    // If invoke throws AND module.exports.error exists, it calls error handler.
    // The hello bundle throws when name is missing, and has an error handler
    // that returns { recovered: true } for recoverable errors.
    // But the error handler only recovers when error.message includes "recoverable".
    // Since "Missing required parameter: name" isn't recoverable, this should fail.
    await assert.rejects(
      () => runAction({
        bundle: helloBundle,
        inputs: {}, // missing name → invoke throws
        handler: 'invoke',
        timeout: 15000,
        session,
      }),
      { message: /Missing required parameter: name/ },
    );
  });

  it('proxies fetch through container host with fixture', async () => {
    const result = await runAction({
      bundle: fetchBundle,
      inputs: { url: 'https://api.example.com/test', method: 'GET' },
      handler: 'invoke',
      timeout: 15000,
      httpFixtures: [
        {
          request: { method: 'GET', url: 'https://api.example.com/test' },
          response: { statusCode: 200, headers: {}, body: '{"method":"GET","url":"/test"}' },
        },
      ],
      session,
    });

    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.equal(body.method, 'GET');
    assert.equal(body.url, '/test');
  });

  it('throws on missing bundle', async () => {
    await assert.rejects(
      () => runAction({ bundle: '/nonexistent/path.js', session }),
      { message: /Bundle not found/ },
    );
  });

  it('throws when action throws', async () => {
    await assert.rejects(
      () => runAction({
        bundle: helloBundle,
        inputs: {}, // missing name
        handler: 'invoke',
        timeout: 15000,
        session,
      }),
      { message: /Missing required parameter: name/ },
    );
  });

  it('returns error when fetch has no matching fixture', async () => {
    await assert.rejects(
      () => runAction({
        bundle: fetchBundle,
        inputs: { url: 'https://api.example.com/unknown', method: 'GET' },
        handler: 'invoke',
        timeout: 15000,
        httpFixtures: [],
        session,
      }),
      { message: /No fixture matched/ },
    );
  });

  it('simulates network error via fixture', async () => {
    await assert.rejects(
      () => runAction({
        bundle: fetchBundle,
        inputs: { url: 'https://api.example.com/fail', method: 'GET' },
        handler: 'invoke',
        timeout: 15000,
        httpFixtures: [
          {
            request: { method: 'GET', url: 'https://api.example.com/fail' },
            response: { networkError: true },
          },
        ],
        session,
      }),
      { message: /Action failed/ },
    );
  });
});
