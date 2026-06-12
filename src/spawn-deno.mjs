import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shimPath = resolve(__dirname, '../shim/shim.js');

/**
 * Check if deno is available on PATH.
 */
function checkDeno() {
  try {
    execFileSync('deno', ['--version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'deno is not installed or not on PATH.\n' +
      'Install Deno: https://deno.land/#installation'
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
    `--allow-read=${shimPath},${bundlePath}`,
    '--no-prompt',
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
