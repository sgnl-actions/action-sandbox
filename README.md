# @sgnl-actions/action-sandbox

SGNL action sandbox. Executes bundled actions inside a Deno sandbox with production-equivalent permission flags (`--deny-net --deny-run --deny-env`), using a mock sandbox host to handle `fetch`, `signJWT`, and LDAP calls.

## Prerequisites

- **Node.js >= 20**
- **Deno** installed and on PATH

## Installation

```bash
npm install -g @sgnl-actions/action-sandbox
```

Or run directly with npx (no install needed):

```bash
npx @sgnl-actions/action-sandbox ./dist/bundle.js --inputs '{"url": "https://httpbin.org/post"}'
```

## Usage

```
sgnl-action-sandbox <bundle-path> [options]

Options:
  --inputs, -i    JSON string or path to JSON file (action inputs)
  --secrets, -s   JSON string or path to JSON file (action secrets)
  --env, -e       Environment JSON string or path to JSON file
  --handler       Handler to invoke: invoke|error|halt (default: invoke)
  --timeout       Timeout in milliseconds (default: 30000)
  --verbose, -v   Show action logs (Deno stderr output)
```

## Examples

```bash
# Run hello-world action
sgnl-action-sandbox ./hello-world/dist/index.js \
  --inputs '{"first_name":"Test","last_name":"User"}'

# Run with secrets from a file
sgnl-action-sandbox ./okta-suspend-user/dist/index.js \
  --inputs '{"userId":"00u123"}' \
  --secrets ./test-secrets.json

# Run error handler
sgnl-action-sandbox ./hello-world/dist/index.js --handler error

# Verbose mode to see action logs
sgnl-action-sandbox ./generic-webhook/dist/index.js \
  --inputs '{"url":"https://httpbin.org/post","method":"POST"}' \
  --verbose
```

## Programmatic API

```js
import { runAction } from "@sgnl-actions/action-sandbox";

const result = await runAction({
  bundle: "./hello-world/dist/index.js",
  inputs: { first_name: "Test", last_name: "User" },
  handler: "invoke",
  timeout: 30000,
  verbose: true,
});

console.log(result);
```

## How It Works

1. The CLI spawns Deno with production sandbox flags
2. Inside Deno, `shim.js` loads the CJS bundle and overrides `fetch`/`ldapts`
3. All external calls route through JSON-RPC over stdin/stdout to the Node.js sandbox host
4. The sandbox host fulfills `fetch` (real HTTP), `signJWT` (ephemeral RSA key), and `ldap` (mock)
5. The bundle result is returned via stdout
