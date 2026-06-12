#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runAction } from '../src/index.mjs';

function usage() {
  console.error(`Usage: sgnl-dev-run <bundle-path> [options]

Options:
  --inputs, -i    JSON string or path to JSON file
  --secrets, -s   JSON string or path to JSON file
  --env, -e       Environment JSON string or path to JSON file
  --handler       Handler to invoke: invoke|error|halt (default: invoke)
  --timeout       Timeout in milliseconds (default: 30000)
  --verbose, -v   Show action logs (Deno stderr output)
  --help, -h      Show this help message
`);
  process.exit(1);
}

/**
 * Parse a JSON argument — either inline JSON string or path to a JSON file.
 */
function parseJsonArg(value) {
  if (!value) return {};
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(trimmed);
  }
  // Treat as file path
  const content = readFileSync(resolve(trimmed), 'utf8');
  return JSON.parse(content);
}

// --- Parse arguments ---
const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  usage();
}

let bundle = null;
let inputs = {};
let secrets = {};
let environment = {};
let handler = 'invoke';
let timeout = 30000;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  switch (arg) {
    case '--inputs':
    case '-i':
      inputs = parseJsonArg(args[++i]);
      break;
    case '--secrets':
    case '-s':
      secrets = parseJsonArg(args[++i]);
      break;
    case '--env':
    case '-e':
      environment = parseJsonArg(args[++i]);
      break;
    case '--handler':
      handler = args[++i];
      break;
    case '--timeout':
      timeout = parseInt(args[++i], 10);
      break;
    case '--verbose':
    case '-v':
      verbose = true;
      break;
    default:
      if (arg.startsWith('-')) {
        console.error(`Unknown option: ${arg}`);
        usage();
      }
      if (!bundle) {
        bundle = arg;
      } else {
        console.error(`Unexpected argument: ${arg}`);
        usage();
      }
  }
}

if (!bundle) {
  console.error('Error: bundle path is required');
  usage();
}

// --- Run ---
try {
  const result = await runAction({ bundle, inputs, secrets, environment, handler, timeout, verbose });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
