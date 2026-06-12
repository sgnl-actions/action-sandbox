import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from '../src/index.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const helloWorldBundle = resolve(__dirname, '../../hello-world/dist/index.js');

describe('runAction integration', () => {
  it('runs hello-world invoke handler', async () => {
    const result = await runAction({
      bundle: helloWorldBundle,
      inputs: { first_name: 'Test', last_name: 'User', language: 'en' },
      handler: 'invoke',
      timeout: 15000,
    });

    assert.equal(result.message, 'Hello World, Test User!');
    assert.equal(result.language, 'en');
    assert.ok(result.processed_at);
  });

  it('runs hello-world error handler with recovery', async () => {
    const result = await runAction({
      bundle: helloWorldBundle,
      inputs: {
        first_name: 'Test',
        last_name: 'User',
        error: { message: 'language error' },
      },
      handler: 'error',
      timeout: 15000,
    });

    assert.equal(result.message, 'Hello World, Test User!');
    assert.equal(result.language, 'en');
  });

  it('runs hello-world halt handler', async () => {
    const result = await runAction({
      bundle: helloWorldBundle,
      inputs: { first_name: 'Test', last_name: 'User', reason: 'testing' },
      handler: 'halt',
      timeout: 15000,
    });

    // halt returns undefined
    assert.equal(result, undefined);
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
        bundle: helloWorldBundle,
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
        bundle: helloWorldBundle,
        inputs: { last_name: 'User' }, // missing first_name
        handler: 'invoke',
        timeout: 15000,
      }),
      { message: /Missing required parameter: first_name/ },
    );
  });

  it('respects timeout', async () => {
    // hello-world is fast, but we can test with an extremely short timeout
    // This is somewhat flaky so we use a very short timeout
    await assert.rejects(
      () => runAction({
        bundle: helloWorldBundle,
        inputs: { first_name: 'Test', last_name: 'User' },
        handler: 'invoke',
        timeout: 1, // 1ms - too short
      }),
      { message: /timed out/ },
    );
  });
});
