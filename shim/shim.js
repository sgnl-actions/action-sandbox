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
const STATUS_TEXTS = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 405: "Method Not Allowed", 408: "Request Timeout",
  409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type",
  422: "Unprocessable Entity", 429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

function statusTextForCode(code) {
  return STATUS_TEXTS[code] || "";
}

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

  // Null-body statuses (204, 304) cannot have a body per HTTP spec
  const nullBodyStatuses = [101, 204, 205, 304];
  const responseBody = (!nullBodyStatuses.includes(result.status) && result.body)
    ? Uint8Array.from(atob(result.body), c => c.charCodeAt(0))
    : null;
  return new Response(responseBody, {
    status: result.status,
    statusText: result.statusText || statusTextForCode(result.status),
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

  async modifyDN(dn, newDN) {
    return await rpcCall("ldap", { operation: "modifyDN", ...this.#connectionInfo(), dn, newDN });
  }

  async compare(dn, attribute, value) {
    return await rpcCall("ldap", { operation: "compare", ...this.#connectionInfo(), dn, attribute, value });
  }
}

const ldaptsModule = {
  Client: MockClient,
  Change: MockChange,
  Attribute: MockAttribute,
  EqualityFilter: class EqualityFilter {
    constructor({ attribute, value }) {
      this.attribute = attribute;
      this.value = value;
    }
    toString() { return `(${this.attribute}=${this.value})`; }
  },
  AndFilter: class AndFilter {
    constructor({ filters }) {
      this.filters = filters || [];
    }
    toString() { return `(&${this.filters.map(f => f.toString()).join('')})`; }
  },
};

// --- Process shim (prevents --deny-env permission errors from bundled SDKs) ---
const processShim = {
  env: {},
  cwd: () => "/app",
  version: "v22.0.0",
  versions: { node: "22.0.0" },
  hrtime: () => [0, 0],
  emitWarning: () => {},
  geteuid: () => 0,
};

// --- CJS require shim ---
import { createRequire } from "node:module";
const nodeRequire = createRequire(import.meta.url);

// --- OS shim (prevents --allow-sys permission errors from bundled SDKs) ---
const osShim = {
  homedir: () => "/tmp",
  tmpdir: () => "/tmp",
  platform: () => "linux",
  arch: () => "x64",
  type: () => "Linux",
  release: () => "6.0.0",
  hostname: () => "sandbox",
  cpus: () => [{ model: "sandbox", speed: 0, times: {} }],
  totalmem: () => 0,
  freemem: () => 0,
  EOL: "\n",
};

// --- HTTP/HTTPS shim (routes Node.js http.request through sandbox IPC) ---
import { EventEmitter } from "node:events";

// Minimal Readable shim to avoid importing node:stream which interferes with Deno's fetch
class ShimReadable extends EventEmitter {
  constructor() {
    super();
    this.readable = true;
    this._flowing = false;
  }
  read() { return null; }
  resume() { this._flowing = true; return this; }
  pause() { this._flowing = false; return this; }
  pipe(dest) {
    this.on("data", (chunk) => dest.write(chunk));
    this.on("end", () => { if (dest.end) dest.end(); });
    this.resume();
    return dest;
  }
  destroy() { this.emit("close"); }
}

class ShimIncomingMessage extends ShimReadable {
  constructor(status, headers, bodyBuf) {
    super();
    this.statusCode = status;
    this.statusMessage = statusTextForCode(status);
    this.headers = {};
    for (const [k, v] of Object.entries(headers || {})) {
      this.headers[k.toLowerCase()] = v;
    }
    this._bodyBuf = bodyBuf;
    this._delivered = false;
  }
  resume() {
    if (!this._delivered) {
      this._delivered = true;
      queueMicrotask(() => {
        if (this._bodyBuf && this._bodyBuf.length > 0) {
          this.emit("data", this._bodyBuf);
        }
        this.emit("end");
      });
    }
    return this;
  }
}

class ShimClientRequest extends EventEmitter {
  constructor(options, callback) {
    super();
    this._options = options;
    this._callback = callback;
    this._body = [];
    this._ended = false;
    this._headersSent = false;
    this._headers = { ...(options.headers || {}) };
  }

  setHeader(name, value) {
    this._headers[name.toLowerCase()] = value;
  }

  getHeader(name) {
    return this._headers[name.toLowerCase()];
  }

  removeHeader(name) {
    delete this._headers[name.toLowerCase()];
  }

  write(chunk) {
    if (typeof chunk === "string") {
      this._body.push(encoder.encode(chunk));
    } else if (chunk instanceof Uint8Array) {
      this._body.push(chunk);
    } else if (chunk) {
      this._body.push(encoder.encode(String(chunk)));
    }
    return true;
  }

  end(chunk, encoding, callback) {
    if (typeof chunk === "function") {
      callback = chunk;
      chunk = null;
    } else if (typeof encoding === "function") {
      callback = encoding;
      encoding = null;
    }
    if (chunk) this.write(chunk);
    this._ended = true;

    // Perform the RPC fetch call
    const protocol = this._options._protocol || "https:";
    const host = this._options.hostname || this._options.host || "localhost";
    const port = this._options.port;
    const path = this._options.path || "/";
    let url = `${protocol}//${host}`;
    if (port && !((protocol === "https:" && port === 443) || (protocol === "http:" && port === 80))) {
      url += `:${port}`;
    }
    url += path;

    const method = (this._options.method || "GET").toUpperCase();

    let bodyBase64 = undefined;
    if (this._body.length > 0) {
      const totalLen = this._body.reduce((sum, b) => sum + b.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const buf of this._body) {
        combined.set(buf, offset);
        offset += buf.length;
      }
      bodyBase64 = btoa(String.fromCharCode(...combined));
    }

    const rpcParams = { url, method, headers: this._headers };
    if (bodyBase64) rpcParams.body = bodyBase64;

    rpcCall("fetch", rpcParams).then((result) => {
      const bodyBuf = result.body
        ? Uint8Array.from(atob(result.body), c => c.charCodeAt(0))
        : new Uint8Array(0);
      const res = new ShimIncomingMessage(result.status, result.headers, bodyBuf);
      if (this._callback) this._callback(res);
      this.emit("response", res);
      if (callback) callback();
    }).catch((err) => {
      this.emit("error", err);
      if (callback) callback(err);
    });
  }

  abort() {
    this.destroy();
  }

  destroy() {
    this.emit("close");
  }

  setTimeout(ms, cb) {
    if (cb) this.once("timeout", cb);
    return this;
  }

  on(event, listener) {
    return super.on(event, listener);
  }
}

function createHttpShim(protocol) {
  function request(urlOrOptions, optionsOrCallback, callback) {
    let options;
    if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
      const parsed = new URL(typeof urlOrOptions === "string" ? urlOrOptions : urlOrOptions.href);
      options = {
        _protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {},
      };
      if (typeof optionsOrCallback === "object") {
        options = { ...options, ...optionsOrCallback };
        // callback is the third arg
      } else if (typeof optionsOrCallback === "function") {
        callback = optionsOrCallback;
      }
    } else {
      options = { ...urlOrOptions, _protocol: protocol };
      if (typeof optionsOrCallback === "function") {
        callback = optionsOrCallback;
      }
    }
    if (!options._protocol) options._protocol = protocol;
    return new ShimClientRequest(options, callback);
  }

  function get(urlOrOptions, optionsOrCallback, callback) {
    let opts;
    if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
      const parsed = new URL(typeof urlOrOptions === "string" ? urlOrOptions : urlOrOptions.href);
      opts = {
        _protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {},
      };
      if (typeof optionsOrCallback === "object") {
        opts = { ...opts, ...optionsOrCallback };
      } else if (typeof optionsOrCallback === "function") {
        callback = optionsOrCallback;
      }
    } else {
      opts = { ...urlOrOptions, _protocol: protocol, method: "GET" };
      if (typeof optionsOrCallback === "function") {
        callback = optionsOrCallback;
      }
    }
    if (!opts._protocol) opts._protocol = protocol;
    const req = new ShimClientRequest(opts, callback);
    req.end();
    return req;
  }

  return {
    request,
    get,
    Agent: class Agent { constructor() {} },
    globalAgent: {},
    METHODS: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
    STATUS_CODES: STATUS_TEXTS,
    IncomingMessage: ShimIncomingMessage,
    ClientRequest: ShimClientRequest,
  };
}

const httpShim = createHttpShim("http:");
const httpsShim = createHttpShim("https:");

function shimRequire(specifier) {
  if (specifier === "ldapts") {
    return ldaptsModule;
  }
  if (specifier === "process" || specifier === "node:process") {
    return processShim;
  }
  if (specifier === "os" || specifier === "node:os") {
    return osShim;
  }
  if (specifier === "http" || specifier === "node:http") {
    return httpShim;
  }
  if (specifier === "https" || specifier === "node:https") {
    return httpsShim;
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
    // If init message contains crypto mock values, short-circuit without IPC
    const context = {
      ...ctx,
      crypto: {
        ...(ctx.crypto || {}),
        signJWT: async (payload, options) => {
          if (ctx.crypto?.signJWT?.returns) {
            return ctx.crypto.signJWT.returns;
          }
          const result = await rpcCall("signJWT", { payload, options });
          return result.token;
        },
      },
    };

    // Load the bundle
    const bundleCode = await Deno.readTextFile(bundlePath);

    const moduleObj = { exports: {} };
    const wrappedFn = new Function("require", "module", "exports", "process", bundleCode);
    wrappedFn(shimRequire, moduleObj, moduleObj.exports, processShim);

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
