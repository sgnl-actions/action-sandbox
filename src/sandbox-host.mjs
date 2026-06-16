import { createInterface } from 'node:readline';
import { createFetchHandler } from './handlers/fetch.mjs';
import { handleSignJWT } from './handlers/sign-jwt.mjs';
import { createLdapHandler } from './handlers/ldap.mjs';

/**
 * Creates a sandbox host that reads JSON-RPC requests from `readStream` (child stdout)
 * and writes responses to `writeStream` (child stdin).
 *
 * The shim uses stdout for both RPC requests and the final result.
 * Lines prefixed with __RESULT__ are the action's output; all other lines are RPC requests.
 *
 * @returns {{ sendInit, close, resultPromise }}
 */
export function createSandboxHost(readStream, writeStream, { verbose = false, fixtures = null, ldapFixtures = null } = {}) {
  const rl = createInterface({ input: readStream });

  const handlers = {
    fetch: createFetchHandler(fixtures),
    signJWT: handleSignJWT,
    ldap: createLdapHandler({ fixtures: ldapFixtures }),
  };

  let resolveResult;
  let rejectResult;
  const resultPromise = new Promise((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  rl.on('line', async (line) => {
    if (!line.trim()) return;

    // Check for the result sentinel
    if (line.startsWith('__RESULT__')) {
      const json = line.slice('__RESULT__'.length);
      resolveResult(json);
      return;
    }

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      const errResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      writeStream.write(JSON.stringify(errResponse) + '\n');
      return;
    }

    const { id, method, params } = request;

    if (verbose) {
      process.stderr.write(`[sandbox] <- ${method}(${JSON.stringify(params).slice(0, 200)})\n`);
    }

    const handler = handlers[method];
    if (!handler) {
      const errResponse = {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
      writeStream.write(JSON.stringify(errResponse) + '\n');
      return;
    }

    try {
      const result = await handler(params || {});

      if (result && result.error) {
        const errResponse = { jsonrpc: '2.0', id, error: result.error };
        writeStream.write(JSON.stringify(errResponse) + '\n');
      } else {
        const response = { jsonrpc: '2.0', id, result };
        writeStream.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      const errResponse = {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err.message || 'Internal error' },
      };
      writeStream.write(JSON.stringify(errResponse) + '\n');
    }

    if (verbose) {
      process.stderr.write(`[sandbox] -> responded to ${method} (id=${id})\n`);
    }
  });

  rl.on('close', () => {
    // If no result was received before stream closed, reject
    rejectResult(new Error('Sandbox stream closed without receiving a result'));
  });

  return {
    /**
     * Send an initialization message to the shim via stdin.
     */
    sendInit(data) {
      writeStream.write(JSON.stringify(data) + '\n');
    },

    /**
     * Promise that resolves with the raw result JSON string from the shim.
     */
    resultPromise,

    close() {
      rl.close();
    },
  };
}
