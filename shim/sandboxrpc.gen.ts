// Code generated from openrpc.json by generate_types.mjs. DO NOT EDIT.

// JSON-RPC 2.0 envelope types.

export interface RPCRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: string;
}

export interface RPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RPCResponse {
  jsonrpc: "2.0";
  result?: Record<string, unknown>;
  error?: RPCError;
  id: string;
}

// Method-specific param and result types.

export interface FetchParams {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: {
    [k: string]: string | undefined;
  };
  /**
   * Base64-encoded request body.
   */
  body?: string;
  /**
   * Connector ID for routing through the connector service.
   */
  connector_id?: string;
}

export interface FetchResult {
  /**
   * HTTP status code.
   */
  status: number;
  /**
   * Response headers.
   */
  headers?: {
    [k: string]: string | undefined;
  };
  /**
   * Base64-encoded response body.
   */
  body?: string;
}

export interface SignJWTParams {
  /**
   * JWT claims to sign.
   */
  payload: {};
  options?: {
    /**
     * JWT type header value.
     */
    typ?: "JWT" | "secevent+jwt";
  };
}

export interface SignJWTResult {
  /**
   * The signed JWT string.
   */
  jwt: string;
}

export interface LdapParams {
  operation: "search" | "add" | "modify" | "delete" | "modifyDN";
  /**
   * LDAP server URL (e.g., ldaps://ldap.example.com:636).
   */
  url: string;
  bindDN: string;
  bindPassword: string;
  /**
   * Base DN for search operations.
   */
  baseDN?: string;
  scope?: "base" | "one" | "sub";
  filter?: string;
  /**
   * Attributes to return in search results.
   */
  attributes?: string[];
  /**
   * Maximum entries to return (0 = no limit).
   */
  sizeLimit?: number;
  /**
   * Maximum time in seconds (0 = no limit).
   */
  timeLimit?: number;
  /**
   * Target DN for add/modify/delete/modifyDN operations.
   */
  dn?: string;
  /**
   * New DN for modifyDN operation.
   */
  newDN?: string;
  /**
   * Changes for modify operations.
   */
  changes?: {
    operation: "add" | "delete" | "replace";
    modification: {
      type: string;
      values: string[];
    };
  }[];
  /**
   * Attributes for add operations.
   */
  attributes_entry?: {
    type: string;
    values: string[];
  }[];
  /**
   * Connector ID for routing through the connector service.
   */
  connector_id?: string;
}

export interface LdapResult {
  /**
   * Search result entries.
   */
  searchEntries?: {}[];
  /**
   * Search result references.
   */
  searchReferences?: string[];
  /**
   * Operation success (for non-search operations).
   */
  success?: boolean;
}

export interface HttpParams {
  /**
   * URL protocol including trailing colon (e.g., "https:", "http:"). Defaults to "https:".
   */
  protocol?: string;
  hostname: string;
  /**
   * Port number. Omitted or 0 means default port for the protocol.
   */
  port?: number;
  /**
   * Request path including query string (e.g., "/api/v1/users?limit=10").
   */
  path?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: {
    [k: string]: string | undefined;
  };
  /**
   * Base64-encoded request body.
   */
  body?: string;
  /**
   * Connector ID for routing through the connector service.
   */
  connector_id?: string;
}

export interface HttpResult {
  /**
   * HTTP status code.
   */
  status: number;
  /**
   * Response headers.
   */
  headers?: {
    [k: string]: string | undefined;
  };
  /**
   * Base64-encoded response body.
   */
  body?: string;
}

// RPC error codes.
export const RPCErrorCodes = {
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  NetworkError: -32000,
  UpstreamError: -32001,
  ConnectorError: -32002,
} as const;
