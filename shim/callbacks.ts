// Proxied API callbacks that route through JSON-RPC to the Go worker.

import { Buffer } from "node:buffer";
import type { RPCResponse, FetchParams, FetchResult, SignJWTParams, SignJWTResult, LdapParams, LdapResult } from "./types.ts";

type RpcCallFn = (method: string, params: Record<string, unknown>) => Promise<RPCResponse>;

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

  return { Client, Change, Attribute };
}
