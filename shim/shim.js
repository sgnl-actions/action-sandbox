// shim.js — Runs inside Deno sandbox.
// Provides CJS loader, fetch/ldap overrides via sandbox host, and invokes the bundle handler.
//
// Sandbox transport:
//   - stdin:  reads from host (JSON-RPC responses + init message)
//   - stdout: writes to host (JSON-RPC requests + __RESULT__ tagged final output)
//   - stderr: action console logs

const bundlePath = Deno.args[0];
if (!bundlePath) {
  Deno.stderr.writeSync(new TextEncoder().encode("shim: missing bundle path argument\n"));
  Deno.exit(1);
}

// --- Redirect console to stderr (keep stdout clean for sandbox transport) ---
const encoder = new TextEncoder();
const writeStderr = (msg) => Deno.stderr.writeSync(encoder.encode(msg));

console.log = (...args) => writeStderr(args.join(" ") + "\n");
console.error = (...args) => writeStderr("[ERROR] " + args.join(" ") + "\n");
console.warn = (...args) => writeStderr("[WARN] " + args.join(" ") + "\n");
console.info = (...args) => writeStderr("[INFO] " + args.join(" ") + "\n");
console.debug = (...args) => writeStderr("[DEBUG] " + args.join(" ") + "\n");

// --- Sandbox transport setup using stdin/stdout ---
let readBuffer = "";
const stdinBuf = new Uint8Array(4096);
const decoder = new TextDecoder();

/**
 * Read a single line from stdin (blocking).
 */
function readLineSync() {
  while (true) {
    const nlIdx = readBuffer.indexOf("\n");
    if (nlIdx !== -1) {
      const line = readBuffer.slice(0, nlIdx);
      readBuffer = readBuffer.slice(nlIdx + 1);
      return line;
    }
    const n = Deno.stdin.readSync(stdinBuf);
    if (n === null || n === 0) {
      const remaining = readBuffer;
      readBuffer = "";
      return remaining || null;
    }
    readBuffer += decoder.decode(stdinBuf.subarray(0, n));
  }
}

/**
 * Write a line to stdout (to host).
 */
function writeLine(str) {
  Deno.stdout.writeSync(encoder.encode(str + "\n"));
}

let requestId = 0;

/**
 * Send a JSON-RPC request to the host via stdout and read response from stdin.
 */
async function rpcCall(method, params) {
  const id = ++requestId;
  const request = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  writeLine(request);

  // Read response from stdin (synchronous — one call at a time)
  const line = readLineSync();
  if (!line) {
    throw new Error(`Sandbox RPC: no response for ${method} (id=${id})`);
  }

  const response = JSON.parse(line);
  if (response.error) {
    const err = new Error(response.error.message || "RPC error");
    err.code = response.error.code;
    throw err;
  }
  return response.result;
}

// --- Override globalThis.fetch ---
globalThis.fetch = async function(input, init = {}) {
  const url = typeof input === "string" ? input : input.url;
  const method = init.method || (input.method ? input.method : "GET");
  const headers = init.headers || {};

  let body = undefined;
  if (init.body) {
    let bodyBytes;
    if (typeof init.body === "string") {
      bodyBytes = encoder.encode(init.body);
    } else if (init.body instanceof Uint8Array) {
      bodyBytes = init.body;
    } else if (init.body instanceof ArrayBuffer) {
      bodyBytes = new Uint8Array(init.body);
    } else {
      bodyBytes = encoder.encode(String(init.body));
    }
    body = btoa(String.fromCharCode(...bodyBytes));
  }

  const result = await rpcCall("fetch", { url, method, headers, body });

  const responseBody = result.body
    ? Uint8Array.from(atob(result.body), c => c.charCodeAt(0))
    : new Uint8Array(0);
  return new Response(responseBody, {
    status: result.status,
    headers: result.headers,
  });
};

// --- Mock ldapts module ---
class MockAttribute {
  constructor({ type, values }) {
    this.type = type;
    this.values = values || [];
  }
}

class MockChange {
  constructor({ operation, modification }) {
    this.operation = operation;
    this.modification = modification;
  }
}

class MockClient {
  constructor(options = {}) {
    this.url = options.url;
    this.timeout = options.timeout;
    this.connectTimeout = options.connectTimeout;
    this.tlsOptions = options.tlsOptions;
  }

  #connectionInfo() {
    return {
      url: this.url,
      tlsOptions: this.tlsOptions,
      timeout: this.timeout,
      connectTimeout: this.connectTimeout,
    };
  }

  async bind(dn, password) {
    return await rpcCall("ldap", { operation: "bind", ...this.#connectionInfo(), dn, password });
  }

  async unbind() {
    return await rpcCall("ldap", { operation: "unbind", url: this.url });
  }

  async search(baseDN, options = {}) {
    return await rpcCall("ldap", { operation: "search", ...this.#connectionInfo(), baseDN, ...options });
  }

  async modify(dn, changes) {
    const serializedChanges = changes.map(c => ({
      operation: c.operation,
      modification: { type: c.modification.type, values: c.modification.values },
    }));
    return await rpcCall("ldap", { operation: "modify", ...this.#connectionInfo(), dn, changes: serializedChanges });
  }

  async add(dn, attributes) {
    return await rpcCall("ldap", { operation: "add", ...this.#connectionInfo(), dn, attributes });
  }

  async del(dn) {
    return await rpcCall("ldap", { operation: "delete", ...this.#connectionInfo(), dn });
  }
}

const ldaptsModule = {
  Client: MockClient,
  Change: MockChange,
  Attribute: MockAttribute,
};

// --- CJS require shim ---
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);

function shimRequire(specifier) {
  if (specifier === "ldapts") {
    return ldaptsModule;
  }
  // Delegate Node.js built-in modules to Deno's Node compatibility layer
  return nodeRequire(specifier);
}

// --- Main execution ---
async function main() {
  try {
    // Read init message from host (first line on stdin)
    const initLine = readLineSync();
    if (!initLine) {
      throw new Error("shim: no init message received from host");
    }
    const initData = JSON.parse(initLine);
    const { handler, params, context: ctx } = initData;

    // Inject context.crypto.signJWT as sandbox-backed function
    const context = {
      ...ctx,
      crypto: {
        ...(ctx.crypto || {}),
        signJWT: async (payload, options) => {
          const result = await rpcCall("signJWT", { payload, options });
          return result.token;
        },
      },
    };

    // Load the bundle
    const bundleCode = await Deno.readTextFile(bundlePath);

    const moduleObj = { exports: {} };
    const wrappedFn = new Function("require", "module", "exports", bundleCode);
    wrappedFn(shimRequire, moduleObj, moduleObj.exports);

    const bundle = moduleObj.exports;

    if (typeof bundle[handler] !== "function") {
      throw new Error(`Bundle does not export handler: ${handler}`);
    }

    // Call the handler
    const result = await bundle[handler](params, context);

    // Write result to stdout with sentinel prefix
    const output = "__RESULT__" + JSON.stringify({ result });
    writeLine(output);
  } catch (err) {
    const output = "__RESULT__" + JSON.stringify({ error: err.message || String(err) });
    writeLine(output);
  }
}

await main();
