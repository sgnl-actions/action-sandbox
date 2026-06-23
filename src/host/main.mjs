// src/host/main.mjs — Host bridge entrypoint for the sandbox container.
//
// Runs inside a Linux container. Accepts scenarios via NDJSON on stdin,
// spawns Deno with the shim (fd3/fd4 IPC), handles RPC requests
// using fixture data, and returns results on stdout.
//
// Protocol:
//   stdin  <- {"type":"run","payload":{...},"fixtures":{...}}\n  (from test runner)
//   stdout -> {"type":"result","success":true,"data":{...}}\n     (to test runner)
//   stdin  <- {"type":"done"}\n                                   (shutdown signal)

import { createInterface } from 'node:readline';
import { runScenario } from './runner.mjs';

async function main() {
  const rl = createInterface({ input: process.stdin });

  for await (const line of rl) {
    if (!line.trim()) continue;

    let message;
    try {
      message = JSON.parse(line);
    } catch (e) {
      process.stdout.write(JSON.stringify({ type: 'error', error: `Invalid JSON: ${e.message}` }) + '\n');
      continue;
    }

    if (message.type === 'done') {
      break;
    }

    if (message.type === 'run') {
      try {
        const result = await runScenario(message);
        process.stdout.write(JSON.stringify({ type: 'result', ...result }) + '\n');
      } catch (e) {
        process.stdout.write(JSON.stringify({ type: 'result', success: false, error: e.message }) + '\n');
      }
    } else {
      process.stdout.write(JSON.stringify({ type: 'error', error: `Unknown message type: ${message.type}` }) + '\n');
    }
  }

  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`Host bridge fatal error: ${e.message}\n`);
  process.exit(1);
});
