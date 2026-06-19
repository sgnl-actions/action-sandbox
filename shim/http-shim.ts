// Minimal node:http / node:https shim that routes requests through the proxied fetch.
//
// The AWS SDK v3 uses http.request() / https.request() internally.
// This shim converts those calls into fetch() calls that go through the IPC bridge.

import { Readable, Writable } from "node:stream";
import { Buffer } from "node:buffer";

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

class IncomingMessage extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  #body: Buffer;
  #pushed = false;

  constructor(statusCode: number, headers: Record<string, string>, body: Buffer) {
    super();
    this.statusCode = statusCode;
    this.statusMessage = "";
    this.headers = headers;
    this.#body = body;
  }

  _read(): void {
    if (!this.#pushed) {
      this.#pushed = true;
      this.push(this.#body);
      this.push(null);
    }
  }
}

class ClientRequest extends Writable {
  #options: Record<string, unknown>;
  #body: Buffer[] = [];
  #fetchFn: FetchFn;
  #defaultProtocol: string;
  #responseEmitted = false;
  // EventEmitter behavior needed alongside writable
  #cbOnResponse: ((res: IncomingMessage) => void) | null = null;

  constructor(options: Record<string, unknown>, fetchFn: FetchFn, defaultProtocol: string) {
    super();
    this.#options = options;
    this.#fetchFn = fetchFn;
    this.#defaultProtocol = defaultProtocol;
  }

  // Override _write for stream.Writable interface
  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.#body.push(Buffer.from(chunk));
    callback();
  }

  // Support direct write() calls from AWS SDK
  write(chunk: string | Uint8Array, encodingOrCb?: string | (() => void), cb?: () => void): boolean {
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : (cb || (() => {}));
    this.#body.push(Buffer.from(chunk));
    if (typeof callback === "function") queueMicrotask(callback);
    return true;
  }

  end(chunk?: string | Uint8Array | (() => void), encodingOrCb?: string | (() => void), _cb?: () => void): this {
    if (typeof chunk === "function") {
      // end(callback)
    } else if (chunk) {
      this.#body.push(Buffer.from(chunk as string | Uint8Array));
    }

    const opts = this.#options;
    const protocol = (opts.protocol as string) || this.#defaultProtocol;
    const scheme = protocol.replace(":", "");
    const hostname = (opts.hostname || opts.host || "localhost") as string;
    // Strip port from host if present (host can be "example.com:443")
    const hostOnly = hostname.includes(":") ? hostname.split(":")[0] : hostname;
    const port = opts.port as string | undefined;
    const path = (opts.path || "/") as string;
    const method = (opts.method || "GET") as string;
    const headers = (opts.headers || {}) as Record<string, string>;

    const portSuffix = port ? `:${port}` : "";
    const url = `${scheme}://${hostOnly}${portSuffix}${path}`;
    const body = this.#body.length > 0 ? Buffer.concat(this.#body).toString() : undefined;

    this.#fetchFn(url, { method, headers, body })
      .then(async (response) => {
        const respHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          respHeaders[key] = value;
        });
        const respBody = Buffer.from(await response.arrayBuffer());
        const msg = new IncomingMessage(response.status, respHeaders, respBody);
        this.#responseEmitted = true;
        this.emit("response", msg);
      })
      .catch((err) => {
        this.emit("error", err);
      });

    return this;
  }

  setTimeout(_ms: number, _cb?: () => void): this {
    return this;
  }

  destroy(): this {
    return this;
  }

  abort(): void {
    // no-op for compatibility
  }

  setNoDelay(): this { return this; }
  setSocketKeepAlive(): this { return this; }
  setHeader(_name: string, _value: string): this { return this; }
  getHeader(_name: string): string | undefined { return undefined; }
  removeHeader(_name: string): void {}
  flushHeaders(): void {}
}

/** Create http/https module shim that routes through the given fetch function. */
export function createHttpShim(fetchFn: FetchFn, defaultProtocol = "https:") {
  function request(urlOrOptions: string | URL | Record<string, unknown>, optionsOrCb?: Record<string, unknown> | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void) {
    let options: Record<string, unknown>;

    if (typeof urlOrOptions === "string" || urlOrOptions instanceof URL) {
      const parsed = new URL(urlOrOptions.toString());
      options = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {},
        ...(typeof optionsOrCb === "object" ? optionsOrCb : {}),
      };
      if (typeof optionsOrCb === "function") cb = optionsOrCb;
    } else {
      options = urlOrOptions;
      if (typeof optionsOrCb === "function") cb = optionsOrCb;
    }

    const req = new ClientRequest(options, fetchFn, defaultProtocol);
    if (cb) req.on("response", cb);
    return req;
  }

  function get(urlOrOptions: string | URL | Record<string, unknown>, optionsOrCb?: Record<string, unknown> | ((res: IncomingMessage) => void), cb?: (res: IncomingMessage) => void) {
    const req = request(urlOrOptions, optionsOrCb, cb);
    req.end();
    return req;
  }

  class Agent {
    maxSockets = Infinity;
    maxFreeSockets = 256;
    options: Record<string, unknown>;
    constructor(opts?: Record<string, unknown>) {
      this.options = opts || {};
    }
    destroy(): void {}
  }

  return {
    request,
    get,
    Agent,
    globalAgent: new Agent(),
    METHODS: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
    STATUS_CODES: {} as Record<number, string>,
    IncomingMessage,
    ClientRequest,
  };
}
