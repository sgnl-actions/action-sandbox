// Proxied API callbacks that route through JSON-RPC to the Go worker.

import { Buffer } from "node:buffer";
import { Readable, Writable } from "node:stream";
import type { RPCResponse, FetchParams, FetchResult, SignJWTParams, SignJWTResult, LdapParams, LdapResult } from "./types.ts";

type RpcCallFn = (method: string, params: Record<string, unknown>) => Promise<RPCResponse>;

const HTTP_STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
  405: "Method Not Allowed", 408: "Request Timeout", 409: "Conflict",
  429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
  504: "Gateway Timeout",
};

/** Create a proxied fetch that routes HTTP through the Go worker. */
export function createProxiedFetch(rpcCall: RpcCallFn, metadata: Record<string, unknown>) {
  return async function proxiedFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    let url: string;
    let method = "GET";
    let headers: Record<string, string> = {};
    let body: string | undefined;

    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
      method = input.method;
      input.headers.forEach((value, key) => { headers[key] = value; });
      if (input.body) {
        body = await input.text();
      }
    }

    if (init?.method) method = init.method;
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((value, key) => { headers[key] = value; });
    }
    if (init?.body !== undefined && init?.body !== null) {
      body = typeof init.body === "string"
        ? init.body
        : new TextDecoder().decode(init.body as ArrayBuffer);
    }

    const params: FetchParams = { url, method: method as FetchParams["method"], headers };
    if (body !== undefined) {
      params.body = Buffer.from(body).toString("base64");
    }
    if (metadata.connector_id) {
      params.connector_id = metadata.connector_id as string;
    }

    const resp = await rpcCall("fetch", params as unknown as Record<string, unknown>);

    if (resp.error) {
      throw new Error(resp.error.message);
    }

    const result = resp.result as unknown as FetchResult;
    const respBody = result.body
      ? Buffer.from(result.body, "base64")
      : null;

    return new Response(respBody, {
      status: result.status,
      statusText: HTTP_STATUS_TEXT[result.status] || "",
      headers: result.headers as Record<string, string> | undefined,
    });
  };
}

/** Create a proxied crypto object with signJWT. */
export function createProxiedCrypto(rpcCall: RpcCallFn) {
  return {
    randomUUID: () => crypto.randomUUID(),
    signJWT: async (
      payload: Record<string, unknown> | null | undefined,
      options: { typ?: string } = {},
    ): Promise<string> => {
      if (options.typ) {
        const validTypes = ["JWT", "secevent+jwt"];
        if (!validTypes.includes(options.typ)) {
          throw new Error(
            `Invalid typ parameter: must be one of ${validTypes.join(", ")}`,
          );
        }
      }

      let normalizedPayload: Record<string, unknown>;
      if (payload === undefined || payload === null) {
        normalizedPayload = {};
      } else if (typeof payload === "object" && !Array.isArray(payload)) {
        normalizedPayload = payload;
      } else {
        throw new TypeError("payload must be an object when signing JWT");
      }

      const params: SignJWTParams = { payload: normalizedPayload };
      if (options.typ) {
        params.options = { typ: options.typ as "JWT" | "secevent+jwt" };
      }

      const resp = await rpcCall("signJWT", params as unknown as Record<string, unknown>);

      if (resp.error) {
        throw new Error(resp.error.message);
      }

      return (resp.result as unknown as SignJWTResult).jwt;
    },
  };
}

/** Create a proxied ldapts module. */
export function createLdaptsProxy(rpcCall: RpcCallFn, metadata: Record<string, unknown>) {
  class Client {
    private url: string;
    private bindDN: string | null = null;
    private bindPassword: string | null = null;

    constructor(options: { url: string }) {
      this.url = options.url;
    }

    async bind(dn: string, password: string): Promise<void> {
      this.bindDN = dn;
      this.bindPassword = password;
    }

    async unbind(): Promise<void> {
      this.bindDN = null;
      this.bindPassword = null;
    }

    async search(
      baseDN: string,
      options: {
        scope?: string;
        filter?: string;
        attributes?: string[];
        sizeLimit?: number;
        timeLimit?: number;
      } = {},
    ) {
      return this._proxyOperation("search", {
        baseDN,
        scope: options.scope || "sub",
        filter: options.filter || "(objectClass=*)",
        attributes: options.attributes,
        sizeLimit: options.sizeLimit || 0,
        timeLimit: options.timeLimit || 0,
      });
    }

    async add(dn: string, entry: Record<string, string[]> | Array<{ type: string; values: string[] }>) {
      const attributes = Array.isArray(entry)
        ? entry
        : Object.entries(entry).map(([type, values]) => ({ type, values }));

      return this._proxyOperation("add", { dn, attributes });
    }

    async modify(dn: string, changes: unknown[] | unknown) {
      const changesArray = Array.isArray(changes) ? changes : [changes];
      return this._proxyOperation("modify", { dn, changes: changesArray });
    }

    async del(dn: string) {
      return this._proxyOperation("delete", { dn });
    }

    async modifyDN(dn: string, newDN: string) {
      return this._proxyOperation("modifyDN", { dn, newDN });
    }

    private async _proxyOperation(operation: LdapParams["operation"], params: Record<string, unknown>) {
      if (!this.bindDN) {
        throw new Error("LDAP client is not bound. Call bind() before performing operations.");
      }

      const rpcParams: LdapParams = {
        operation,
        ...params,
        url: this.url,
        bindDN: this.bindDN,
        bindPassword: this.bindPassword,
      } as LdapParams;

      if (metadata.connector_id) {
        rpcParams.connector_id = metadata.connector_id as string;
      }

      const resp = await rpcCall("ldap", rpcParams as unknown as Record<string, unknown>);

      if (resp.error) {
        const err = new Error(resp.error.message);
        (err as unknown as Record<string, unknown>).code = resp.error.code;
        throw err;
      }

      return resp.result as unknown as LdapResult;
    }
  }

  class Change {
    operation: string;
    modification: { type: string; values: string[] };

    constructor(options: { operation: string; modification: { type: string; values: string[] } }) {
      this.operation = options.operation;
      this.modification = options.modification;
    }
  }

  class Attribute {
    type: string;
    values: string[];

    constructor(options: { type: string; values: string[] }) {
      this.type = options.type;
      this.values = options.values;
    }
  }

  // LDAP filter classes — serialize to RFC 4515 filter strings for search operations.

  /** Escape special characters per RFC 4515 §3: \, *, (, ), NUL */
  function escapeFilterValue(value: string): string {
    return value.replace(/[\\*()\x00]/g, (c) =>
      "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"),
    );
  }

  class EqualityFilter {
    attribute: string;
    value: string | Uint8Array;
    constructor(options: { attribute: string; value: string | Uint8Array }) {
      this.attribute = options.attribute;
      this.value = options.value;
    }
    toString(): string {
      if (this.value instanceof Uint8Array || Buffer.isBuffer(this.value)) {
        const hex = Buffer.from(this.value).toString("hex").replace(/../g, "\\$&");
        return `(${this.attribute}=${hex})`;
      }
      return `(${this.attribute}=${escapeFilterValue(String(this.value))})`;
    }
  }

  class AndFilter {
    filters: { toString(): string }[];
    constructor(options: { filters: { toString(): string }[] }) {
      this.filters = options.filters;
    }
    toString(): string {
      return `(&${this.filters.map(f => f.toString()).join("")})`;
    }
  }

  class OrFilter {
    filters: { toString(): string }[];
    constructor(options: { filters: { toString(): string }[] }) {
      this.filters = options.filters;
    }
    toString(): string {
      return `(|${this.filters.map(f => f.toString()).join("")})`;
    }
  }

  class SubstringFilter {
    attribute: string;
    initial: string;
    any: string[];
    final: string;
    constructor(options: { attribute: string; initial?: string; any?: string[]; final?: string }) {
      this.attribute = options.attribute;
      this.initial = options.initial || "";
      this.any = options.any || [];
      this.final = options.final || "";
    }
    toString(): string {
      const parts = [
        escapeFilterValue(this.initial),
        "*",
        this.any.map(s => escapeFilterValue(s)).join("*"),
        "*",
        escapeFilterValue(this.final),
      ];
      return `(${this.attribute}=${parts.join("")})`;
    }
  }

  class PresenceFilter {
    attribute: string;
    constructor(options: { attribute: string }) {
      this.attribute = options.attribute;
    }
    toString(): string {
      return `(${this.attribute}=*)`;
    }
  }

  return { Client, Change, Attribute, EqualityFilter, AndFilter, OrFilter, SubstringFilter, PresenceFilter };
}

// --- node:http / node:https shim ---

class IncomingMessage extends Readable {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  #body: Buffer;
  #pushed = false;

  constructor(statusCode: number, headers: Record<string, string>, body: Buffer) {
    super();
    this.statusCode = statusCode;
    this.statusMessage = HTTP_STATUS_TEXT[statusCode] || "";
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
  #rpcCall: RpcCallFn;
  #metadata: Record<string, unknown>;
  #defaultProtocol: string;

  constructor(options: Record<string, unknown>, rpcCall: RpcCallFn, metadata: Record<string, unknown>, defaultProtocol: string) {
    super();
    this.#options = options;
    this.#rpcCall = rpcCall;
    this.#metadata = metadata;
    this.#defaultProtocol = defaultProtocol;
  }

  _write(chunk: Buffer | string, _encoding: string, callback: () => void): void {
    this.#body.push(Buffer.from(chunk));
    callback();
  }

  write(chunk: string | Uint8Array, encodingOrCb?: string | (() => void), cb?: () => void): boolean {
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : (cb || (() => {}));
    this.#body.push(Buffer.from(chunk));
    if (typeof callback === "function") queueMicrotask(callback);
    return true;
  }

  end(chunk?: string | Uint8Array | (() => void), _encodingOrCb?: string | (() => void), _cb?: () => void): this {
    if (typeof chunk === "function") {
      // end(callback)
    } else if (chunk) {
      this.#body.push(Buffer.from(chunk as string | Uint8Array));
    }

    const opts = this.#options;
    const protocol = (opts.protocol as string) || this.#defaultProtocol;
    const hostname = (opts.hostname || opts.host || "localhost") as string;
    const hostOnly = hostname.includes(":") ? hostname.split(":")[0] : hostname;
    const port = opts.port ? Number(opts.port) : undefined;
    const path = (opts.path || "/") as string;
    const method = ((opts.method || "GET") as string).toUpperCase();
    const headers = (opts.headers || {}) as Record<string, string>;
    const body = this.#body.length > 0
      ? Buffer.concat(this.#body).toString("base64")
      : undefined;

    const portPart = port ? `:${port}` : "";
    const url = `${protocol}//${hostOnly}${portPart}${path}`;

    const params: Record<string, unknown> = { url, method, headers };
    if (body !== undefined) params.body = body;
    if (this.#metadata.connector_id) params.connector_id = this.#metadata.connector_id;

    this.#rpcCall("fetch", params)
      .then((resp) => {
        if (resp.error) {
          this.emit("error", new Error(resp.error.message));
          return;
        }

        const result = resp.result as unknown as FetchResult;
        const respBody = result.body
          ? Buffer.from(result.body, "base64")
          : Buffer.alloc(0);

        const msg = new IncomingMessage(result.status, (result.headers || {}) as Record<string, string>, respBody);
        this.emit("response", msg);
      })
      .catch((err) => {
        this.emit("error", err);
      });

    return this;
  }

  setTimeout(_ms: number, _cb?: () => void): this { return this; }
  destroy(): this { return this; }
  abort(): void {}
  setNoDelay(): this { return this; }
  setSocketKeepAlive(): this { return this; }
  setHeader(_name: string, _value: string): this { return this; }
  getHeader(_name: string): string | undefined { return undefined; }
  removeHeader(_name: string): void {}
  flushHeaders(): void {}
}

/** Create a proxied http/https module that routes through the "fetch" RPC method. */
export function createProxiedHttp(rpcCall: RpcCallFn, metadata: Record<string, unknown>, defaultProtocol = "https:") {
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

    const req = new ClientRequest(options, rpcCall, metadata, defaultProtocol);
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
    STATUS_CODES: HTTP_STATUS_TEXT,
    IncomingMessage,
    ClientRequest,
  };
}
