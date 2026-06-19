import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, unlinkSync, createReadStream, createWriteStream, open as fsOpen } from 'node:fs';
import { SHIM_DIR, BUNDLE_PATH, DENO_BIN, FIFO_FD3, FIFO_FD4 } from './constants.mjs';
import { setupFetchFixtures, cleanupFetchFixtures, handleFetch } from './handlers/fetch.mjs';
import { createLdapHandler } from './handlers/ldap.mjs';
import { createRPCDispatcher } from './rpc.mjs';

let scenarioCount = 0;

export async function runScenario(scenario) {
  const { payload, fixtures = {}, verbose = false } = scenario;
  const { script, inputs, secrets, outputs, environment, data, metadata, timeout } = payload;

  // Write bundle to temp file
  writeFileSync(BUNDLE_PATH, script);

  // Create handlers from fixtures
  setupFetchFixtures(fixtures.http || null);
  const ldapHandler = createLdapHandler(fixtures.ldap || null);
  const dispatch = createRPCDispatcher(handleFetch, ldapHandler);

  // Create fresh fifos for this scenario
  const fd3Path = `${FIFO_FD3}.${scenarioCount}`;
  const fd4Path = `${FIFO_FD4}.${scenarioCount}`;
  scenarioCount++;

  try { unlinkSync(fd3Path); } catch {}
  try { unlinkSync(fd4Path); } catch {}
  execSync(`mkfifo ${fd3Path} ${fd4Path}`);

  // Spawn Deno via shell with real pipe fds.
  // Shell redirection `3<fifo 4>fifo` gives Deno actual pipe file descriptors.
  const denoCmd = [
    DENO_BIN, 'run',
    '--deny-net',
    '--deny-run',
    '--deny-env',
    `--allow-read=/dev/fd/3,${SHIM_DIR},${BUNDLE_PATH}`,
    '--allow-write=/dev/fd/4',
    '--no-prompt',
    '--v8-flags=--max-old-space-size=64',
    `${SHIM_DIR}/mod.ts`,
  ].join(' ');

  const child = spawn('/bin/sh', ['-c', `${denoCmd} 3<${fd3Path} 4>${fd4Path}`], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Build payload matching production format
  const denoPayload = {
    script,
    inputs: inputs || {},
    secrets: secrets || {},
    outputs: outputs || {},
    environment: environment || {},
    data: data || {},
    metadata: metadata || {},
    timeout: timeout || 30000,
    jobId: 'test-job',
    tenantId: 'test-tenant',
    clientId: 'test-client',
    jobType: 'test',
    workflowId: '',
  };

  // Write payload to Deno's stdin, then close it
  child.stdin.write(JSON.stringify(denoPayload));
  child.stdin.end();

  // Open the fifos from the host side.
  // fs.open with callback uses libuv threadpool internally, so it won't
  // block the main event loop even though fifos block until both ends connect.
  // fd3: host WRITES responses -> Deno READS from fd3
  // fd4: Deno WRITES requests -> host READS from fd4
  const [fd3Fd, fd4Fd] = await Promise.all([
    new Promise((resolve, reject) => fsOpen(fd3Path, 'w', (err, fd) => err ? reject(err) : resolve(fd))),
    new Promise((resolve, reject) => fsOpen(fd4Path, 'r', (err, fd) => err ? reject(err) : resolve(fd))),
  ]);

  const fd3WriteStream = createWriteStream(null, { fd: fd3Fd, autoClose: true });
  const fd4ReadStream = createReadStream(null, { fd: fd4Fd, autoClose: true });

  // Handle RPC requests from fd4 and write responses to fd3
  const rpcReader = createInterface({ input: fd4ReadStream });

  rpcReader.on('line', (line) => {
    if (!line.trim()) return;

    let request;
    try {
      request = JSON.parse(line);
    } catch {
      fd3WriteStream.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }

    const { id, method, params } = request;

    if (verbose) {
      process.stderr.write(`[rpc] ${method}(${JSON.stringify(params).slice(0, 200)})\n`);
    }

    const result = dispatch(method, params || {});

    let response;
    if (result && result.error) {
      response = { jsonrpc: '2.0', id, error: result.error };
    } else {
      response = { jsonrpc: '2.0', id, result };
    }

    fd3WriteStream.write(JSON.stringify(response) + '\n');
  });

  // Collect stdout (result) and stderr (logs)
  let stdout = '';
  let stderr = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (verbose) process.stderr.write(chunk);
  });

  // Wait for process to exit with timeout
  const scenarioTimeout = timeout || 30000;

  const result = await new Promise((resolve) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      resolve({ success: false, error: `Timeout after ${scenarioTimeout}ms` });
    }, scenarioTimeout);

    child.on('close', (code) => {
      if (timedOut) return;
      clearTimeout(timer);

      rpcReader.close();
      try { fd3WriteStream.end(); } catch {}
      try { fd4ReadStream.destroy(); } catch {}

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolve({ success: false, error: `Deno exited with code ${code}, no output. stderr: ${stderr.slice(0, 500)}` });
        return;
      }

      try {
        resolve(JSON.parse(trimmed));
      } catch (e) {
        resolve({ success: false, error: `Parse error: ${e.message}. Raw: ${trimmed.slice(0, 200)}` });
      }
    });

    child.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ success: false, error: `Spawn error: ${err.message}` });
    });
  });

  // Cleanup fifos and fixtures
  try { unlinkSync(fd3Path); } catch {}
  try { unlinkSync(fd4Path); } catch {}
  cleanupFetchFixtures();

  return result;
}
