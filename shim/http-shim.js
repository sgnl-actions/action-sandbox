// http-shim.js — Thin adapter from Node.js http API to globalThis.fetch.
// Since fetch is already shimmed to route through sandbox RPC, this just
// translates the EventEmitter-based http interface into fetch() calls.

import { EventEmitter } from "node:events";
import { STATUS_TEXTS } from "./fetch-shim.js";

const encoder = new TextEncoder();

class ShimIncomingMessage extends EventEmitter {
  constructor(status, headers, bodyBuf) {
    super();
    this.statusCode = status;
    this.statusMessage = STATUS_TEXTS[status] || "";
    this.headers = {};
    for (const [k, v] of Object.entries(headers || {})) {
      this.headers[k.toLowerCase()] = v;
    }
    this._bodyBuf = bodyBuf;
    this._delivered = false;
  }
  read() { return null; }
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
  pause() { return this; }
  pipe(dest) {
    this.on("data", (chunk) => dest.write(chunk));
    this.on("end", () => { if (dest.end) dest.end(); });
    this.resume();
    return dest;
  }
  destroy() { this.emit("close"); }
}

class ShimClientRequest extends EventEmitter {
  constructor(options, callback) {
    super();
    this._options = options;
    this._callback = callback;
    this._body = [];
    this._headers = { ...(options.headers || {}) };
  }

  setHeader(name, value) { this._headers[name.toLowerCase()] = value; }
  getHeader(name) { return this._headers[name.toLowerCase()]; }
  removeHeader(name) { delete this._headers[name.toLowerCase()]; }

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
    if (typeof chunk === "function") { callback = chunk; chunk = null; }
    else if (typeof encoding === "function") { callback = encoding; encoding = null; }
    if (chunk) this.write(chunk);

    const protocol = this._options._protocol || "https:";
    const host = this._options.hostname || this._options.host || "localhost";
    const port = this._options.port;
    const path = this._options.path || "/";
    let url = `${protocol}//${host}`;
    if (port && !((protocol === "https:" && +port === 443) || (protocol === "http:" && +port === 80))) {
      url += `:${port}`;
    }
    url += path;

    const method = (this._options.method || "GET").toUpperCase();
    const fetchOpts = { method, headers: this._headers };

    if (this._body.length > 0) {
      const totalLen = this._body.reduce((sum, b) => sum + b.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const buf of this._body) { combined.set(buf, offset); offset += buf.length; }
      fetchOpts.body = combined;
    }

    globalThis.fetch(url, fetchOpts).then(async (response) => {
      const bodyBuf = new Uint8Array(await response.arrayBuffer());
      const headers = {};
      response.headers.forEach((v, k) => { headers[k] = v; });
      const res = new ShimIncomingMessage(response.status, headers, bodyBuf);
      if (this._callback) this._callback(res);
      this.emit("response", res);
      if (callback) callback();
    }).catch((err) => {
      this.emit("error", err);
      if (callback) callback(err);
    });
  }

  abort() { this.destroy(); }
  destroy() { this.emit("close"); }
  setTimeout(ms, cb) { if (cb) this.once("timeout", cb); return this; }
}

function parseOptions(urlOrOptions, optionsOrCallback, callback, defaultProtocol) {
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
    } else if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    }
  } else {
    options = { ...urlOrOptions, _protocol: defaultProtocol };
    if (typeof optionsOrCallback === "function") {
      callback = optionsOrCallback;
    }
  }
  if (!options._protocol) options._protocol = defaultProtocol;
  return { options, callback };
}

function createHttpShim(protocol) {
  function request(urlOrOptions, optionsOrCallback, cb) {
    const { options, callback } = parseOptions(urlOrOptions, optionsOrCallback, cb, protocol);
    return new ShimClientRequest(options, callback);
  }

  function get(urlOrOptions, optionsOrCallback, cb) {
    const { options, callback } = parseOptions(urlOrOptions, optionsOrCallback, cb, protocol);
    options.method = "GET";
    const req = new ShimClientRequest(options, callback);
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

export const httpShim = createHttpShim("http:");
export const httpsShim = createHttpShim("https:");
