import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shimDir = resolve(__dirname, '../shim');
const shimPath = resolve(shimDir, 'shim.js');

const MIN_DENO_MAJOR = 2;

/**
 * Check if deno is available on PATH and meets minimum version.
 */
function checkDeno() {
  let output;
  try {
    output = execFileSync('deno', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
  } catch {
    throw new Error(
      'deno is not installed or not on PATH.\n' +
      'Install Deno: https://deno.land/#installation'
    );
  }

  const match = output.match(/deno (\d+)\./);
  if (match && parseInt(match[1], 10) < MIN_DENO_MAJOR) {
    throw new Error(
      `Deno ${MIN_DENO_MAJOR}.x or higher is required (found: ${output.split('\n')[0].trim()}).\n` +
      'Update Deno: https://deno.land/#installation'
    );
  }
}

/**
 * Spawn Deno with production sandbox flags.
 *
 * Sandbox transport (avoids /dev/fd/* which Deno 2 blocks on macOS):
 *   - stdin:  host → deno (JSON-RPC responses + init message)
 *   - stdout: deno → host (JSON-RPC requests + final result tagged as __RESULT__)
 *   - stderr: action logs (passed through)
 *
 * @param {string} bundlePath - Absolute path to the bundled action
 * @returns {{ process, hostWrite, hostRead }}
 *   - hostWrite: writable stream (child.stdin) for host → deno
 *   - hostRead:  readable stream (child.stdout) for deno → host
 */
export function spawnDeno(bundlePath) {
  checkDeno();

  const child = spawn('deno', [
    'run',
    '--deny-net',
    '--deny-run',
    '--deny-env',
    `--allow-read=${shimDir},${bundlePath}`,
    '--no-prompt',
    '--cached-only',
    shimPath,
    bundlePath,
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    process: child,
    hostWrite: child.stdin,
    hostRead: child.stdout,
  };
}
