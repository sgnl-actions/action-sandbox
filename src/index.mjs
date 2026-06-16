import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnDeno } from './spawn-deno.mjs';
import { createSandboxHost } from './sandbox-host.mjs';

/**
 * Run a SGNL action bundle in the Deno sandbox.
 *
 * @param {object} options
 * @param {string} options.bundle - Path to the bundled action JS file
 * @param {object} [options.inputs={}] - Action inputs
 * @param {object} [options.secrets={}] - Action secrets
 * @param {object} [options.environment={}] - Environment data
 * @param {string} [options.handler='invoke'] - Handler to call (invoke|error|halt)
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @param {boolean} [options.verbose=false] - Show action stderr output
 * @param {Array|null} [options.fixtures=null] - HTTP fixtures for fetch (disables passthrough)
 * @param {Array|null} [options.ldapFixtures=null] - LDAP fixtures (disables real LDAP)
 * @returns {Promise<any>} The action result
 */
export async function runAction({
  bundle,
  inputs = {},
  secrets = {},
  environment = {},
  handler = 'invoke',
  timeout = 30000,
  verbose = false,
  fixtures = null,
  ldapFixtures = null,
} = {}) {
  const bundlePath = resolve(bundle);

  if (!existsSync(bundlePath)) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }

  // Spawn Deno with sandbox flags
  const { process: child, hostWrite, hostRead } = spawnDeno(bundlePath);

  // Create sandbox host: reads RPC requests from child stdout, writes responses to child stdin
  const sandbox = createSandboxHost(hostRead, hostWrite, { verbose, fixtures, ldapFixtures });

  // Send init message to the shim
  sandbox.sendInit({
    handler,
    params: inputs,
    context: {
      secrets,
      environment,
      crypto: {},
    },
  });

  // Collect stderr for action logs
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (verbose) {
      process.stderr.write(chunk);
    }
  });

  // Wait for result with timeout
  const result = await new Promise((resolvePromise, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error(`Action timed out after ${timeout}ms`));
    }, timeout);

    // The result comes through the sandbox host's resultPromise
    sandbox.resultPromise
      .then((resultJson) => {
        if (timedOut) return;
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(resultJson);
          if (parsed.error) {
            reject(new Error(`Action error: ${parsed.error}`));
          } else {
            resolvePromise(parsed.result);
          }
        } catch (parseErr) {
          reject(new Error(
            `Failed to parse action output: ${parseErr.message}\nRaw output: ${resultJson}`
          ));
        }
      })
      .catch((err) => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(new Error(
          `Action failed: ${err.message}` +
          (stderr ? `\nStderr: ${stderr}` : '')
        ));
      });

    child.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      reject(new Error(`Failed to spawn Deno: ${err.message}`));
    });
  });

  return result;
}
