# @sgnl-actions/action-sandbox

Run SGNL action bundles in a Deno sandbox with production-equivalent permission flags. All external calls (HTTP, LDAP, JWT signing) are proxied through a host bridge via IPC, enabling fixture-based testing without real network access.

## Prerequisites

- **Node.js** >= 20
- **Docker** (the sandbox runs inside a container with Deno pre-installed)

## Usage

### CLI

```bash
# Run a bundle with inputs
sgnl-action-sandbox dist/index.js --inputs '{"name": "Alice"}'

# With secrets and environment
sgnl-action-sandbox dist/index.js \
  -i '{"userId": "123"}' \
  -s '{"API_KEY": "sk-..."}' \
  -e '{"BASE_URL": "https://api.example.com"}'

# From JSON files
sgnl-action-sandbox dist/index.js \
  --inputs tests/inputs.json \
  --secrets tests/secrets.json

# Verbose mode (shows action logs)
sgnl-action-sandbox dist/index.js -i '{"name": "test"}' --verbose

# Custom timeout (ms)
sgnl-action-sandbox dist/index.js -i '{}' --timeout 60000
```

### Programmatic API

```javascript
import { runAction } from "@sgnl-actions/action-sandbox";

const result = await runAction({
  bundle: "dist/index.js",
  inputs: { userId: "123" },
  secrets: { API_KEY: "sk-..." },
  environment: { BASE_URL: "https://api.example.com" },
  handler: "invoke",
  timeout: 30000,
  verbose: false,
});

console.log(result);
```

### With `@sgnl-actions/testing`

The sandbox is typically used via the `sgnl-sandbox-test` CLI provided by `@sgnl-actions/testing`. It auto-discovers `dist/index.js` + `tests/scenarios.yaml` and runs each scenario through the sandbox with nock-based HTTP mocking:

```bash
npx sgnl-sandbox-test
npx sgnl-sandbox-test --verbose
npx sgnl-sandbox-test --common  # include common error scenarios
```

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│  Test Runner (Node.js)                                       │
│                                                              │
│  runAction() / ContainerSession                              │
│    ├── Starts Docker container (sandbox-runner image)        │
│    └── Streams scenarios via NDJSON on stdin/stdout          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  Docker Container                                            │
│                                                              │
│  Host Bridge (src/host/main.mjs)                             │
│    ├── Receives scenario messages from test runner           │
│    ├── Spawns Deno with sandbox flags + fifo IPC             │
│    └── RPC Dispatcher (handles calls from Deno shim)         │
│          ├── fetch   → fixture-based HTTP matching           │
│          ├── signJWT → ephemeral RSA-2048 signing            │
│          └── ldap    → fixture-based LDAP matching           │
│                                                              │
│  Deno Sandbox (isolated subprocess)                          │
│    Permissions: --deny-net --deny-run --deny-env             │
│    shim/mod.ts                                               │
│      ├── Loads bundle via require()                          │
│      ├── Calls module.exports[handler](params, context)      │
│      ├── Proxies fetch/crypto/ldap through fifo IPC to host  │
│      └── Returns result on fd3                               │
└──────────────────────────────────────────────────────────────┘
```

The Deno subprocess runs with strict permission denial inside a Docker container. Any attempt by action code to access the network, spawn processes, or read environment variables is blocked at the OS level. All external calls go through the shim's IPC layer back to the host bridge, which resolves them against fixture data.

## API Reference

### `runAction(options)`

| Option         | Type          | Default    | Description                                   |
| -------------- | ------------- | ---------- | --------------------------------------------- |
| `bundle`       | `string`      | (required) | Path to the bundled action JS file            |
| `inputs`       | `object`      | `{}`       | Action input parameters                       |
| `secrets`      | `object`      | `{}`       | Secret values (API keys, tokens)              |
| `environment`  | `object`      | `{}`       | Environment data                              |
| `handler`      | `string`      | `'invoke'` | Handler to call: `invoke`, `error`, or `halt` |
| `timeout`      | `number`      | `30000`    | Timeout in milliseconds                       |
| `verbose`      | `boolean`     | `false`    | Show Deno stderr output                       |
| `ldapFixtures` | `Array\|null` | `null`     | LDAP fixture data (disables real LDAP)        |

Returns a `Promise` that resolves with the action's return value, or rejects if the action throws, times out, or fails to spawn.

## RPC Methods

The sandbox shim proxies these calls from action code to the host:

| Method    | Description                                                                      |
| --------- | -------------------------------------------------------------------------------- |
| `fetch`   | HTTP requests — intercepted by nock in test mode, or passed through to real HTTP |
| `signJWT` | JWT signing — uses an ephemeral RSA-2048 key pair                                |
| `ldap`    | LDAP operations — uses real `ldapts` client or fixture responses                 |

## Development

```bash
# Build the Docker image locally
docker build -t ghcr.io/sgnl-actions/sandbox-runner:latest .

# Run tests
npm test

# Run a single test file
node --test tests/integration.test.mjs
```

## License

MIT
