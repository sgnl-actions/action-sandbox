#!/usr/bin/env node
// scripts/test-container.mjs — Smoke test for the container host bridge.
//
// Usage:
//   1. Build the container: docker build -t sandbox-runner .
//   2. Run this script:     node scripts/test-container.mjs
//
// Sends a minimal action through the container and verifies it returns a result.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const IMAGE = process.env.SANDBOX_IMAGE || 'sandbox-runner';

// A minimal action bundle that returns { status: 'success', message: 'hello' }
const BUNDLE = `
module.exports.invoke = async function(params, context) {
  const greeting = params.name || 'world';
  return { status: 'success', message: 'hello ' + greeting };
};
`;

// A bundle that uses fetch (to test RPC through fd3/fd4)
const FETCH_BUNDLE = `
module.exports.invoke = async function(params, context) {
  const resp = await fetch(params.address, {
    method: params.method || 'GET',
    headers: { 'Authorization': 'Bearer ' + context.secrets.TOKEN },
  });
  const body = await resp.text();
  return { status: resp.status === 200 ? 'success' : 'error', body };
};
`;

async function runTest(name, scenario, expected) {
  process.stdout.write(`  ${name}... `);

  const container = spawn('docker', ['run', '--rm', '-i', IMAGE], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  container.stdout.on('data', (d) => { stdout += d; });
  container.stderr.on('data', (d) => { stderr += d; });

  // Send scenario
  container.stdin.write(JSON.stringify(scenario) + '\n');
  // Send done
  container.stdin.write('{"type":"done"}\n');

  await new Promise((resolve) => container.on('close', resolve));

  const lines = stdout.trim().split('\n').filter(Boolean);
  if (lines.length === 0) {
    console.log('FAIL (no output)');
    if (stderr) console.log('    stderr:', stderr.slice(0, 500));
    return false;
  }

  const result = JSON.parse(lines[0]);

  const pass = expected(result);
  if (pass) {
    console.log('PASS');
  } else {
    console.log('FAIL');
    console.log('    got:', JSON.stringify(result, null, 2).slice(0, 500));
    if (stderr) console.log('    stderr:', stderr.slice(0, 500));
  }
  return pass;
}

async function main() {
  console.log('Container smoke tests:');

  let passed = 0;
  let failed = 0;

  // Test 1: Simple invoke with no network
  const t1 = await runTest('simple invoke', {
    type: 'run',
    payload: {
      script: BUNDLE,
      inputs: { name: 'container' },
      secrets: {},
      outputs: {},
      environment: {},
      data: {},
      metadata: {},
      timeout: 10000,
    },
    fixtures: {},
  }, (r) => r.type === 'result' && r.success === true && r.data?.message === 'hello container');

  if (t1) passed++; else failed++;

  // Test 2: Fetch with fixture
  const t2 = await runTest('fetch with fixture', {
    type: 'run',
    payload: {
      script: FETCH_BUNDLE,
      inputs: { address: 'https://api.example.com/users/1', method: 'GET' },
      secrets: { TOKEN: 'test-token' },
      outputs: {},
      environment: {},
      data: {},
      metadata: {},
      timeout: 10000,
    },
    fixtures: {
      http: [
        {
          request: { method: 'GET', url: 'https://api.example.com/users/1' },
          response: { statusCode: 200, headers: {}, body: '{"id":1,"name":"Alice"}' },
        },
      ],
    },
  }, (r) => r.type === 'result' && r.success === true && r.data?.status === 'success');

  if (t2) passed++; else failed++;

  // Test 3: Fetch with no matching fixture (should error)
  const t3 = await runTest('fetch no fixture match → error', {
    type: 'run',
    payload: {
      script: FETCH_BUNDLE,
      inputs: { address: 'https://api.example.com/unknown', method: 'GET' },
      secrets: { TOKEN: 'x' },
      outputs: {},
      environment: {},
      data: {},
      metadata: {},
      timeout: 10000,
    },
    fixtures: { http: [] },
  }, (r) => r.type === 'result' && r.success === false);

  if (t3) passed++; else failed++;

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
