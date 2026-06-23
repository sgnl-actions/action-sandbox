import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { ContainerSession, checkDocker } from './container-session.mjs';

export { ContainerSession, checkDocker } from './container-session.mjs';

/**
 * Run a SGNL action bundle in the Deno sandbox via the container.
 *
 * @param {object} options
 * @param {string} options.bundle - Path to the bundled action JS file
 * @param {object} [options.inputs={}] - Action inputs
 * @param {object} [options.secrets={}] - Action secrets
 * @param {object} [options.environment={}] - Environment data
 * @param {string} [options.handler='invoke'] - Handler to call (invoke|error|halt)
 * @param {number} [options.timeout=30000] - Timeout in milliseconds
 * @param {boolean} [options.verbose=false] - Show action stderr output
 * @param {Array|null} [options.httpFixtures=null] - HTTP fixtures for the container host
 * @param {Array|null} [options.ldapFixtures=null] - LDAP fixtures for the container host
 * @param {ContainerSession} [options.session] - Shared container session (created if not provided)
 * @returns {Promise<object>} The action result
 */
export async function runAction({
  bundle,
  inputs = {},
  secrets = {},
  environment = {},
  handler = 'invoke',
  timeout = 30000,
  verbose = false,
  httpFixtures = null,
  ldapFixtures = null,
  session = null,
} = {}) {
  const bundlePath = resolve(bundle);

  if (!existsSync(bundlePath)) {
    throw new Error(`Bundle not found: ${bundlePath}`);
  }

  // Read the bundle content — container receives it inline
  const script = readFileSync(bundlePath, 'utf8');

  // If no session provided, create a one-shot session
  const ownSession = !session;
  if (ownSession) {
    session = new ContainerSession();
    await session.start();
  }

  try {
    const result = await session.run({
      payload: {
        script,
        inputs,
        secrets,
        outputs: {},
        environment,
        data: {},
        metadata: {},
        timeout,
      },
      fixtures: {
        http: httpFixtures || [],
        ldap: ldapFixtures || [],
      },
      verbose,
    });

    // Container returns { type: 'result', success, data?, error? }
    if (result.type === 'error') {
      throw new Error(`Container error: ${result.error}`);
    }

    if (!result.success) {
      throw new Error(`Action failed: ${result.error || 'unknown error'}`);
    }

    return result.data;
  } finally {
    if (ownSession) {
      await session.close();
    }
  }
}
