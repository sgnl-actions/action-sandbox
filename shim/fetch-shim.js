// fetch-shim.js — Override globalThis.fetch to route through sandbox host IPC.

import { rpcCall, encoder } from "./transport.js";

export const STATUS_TEXTS = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden",
  404: "Not Found", 405: "Method Not Allowed", 408: "Request Timeout",
  409: "Conflict", 413: "Payload Too Large", 415: "Unsupported Media Type",
  422: "Unprocessable Entity", 429: "Too Many Requests",
  500: "Internal Server Error", 502: "Bad Gateway",
  503: "Service Unavailable", 504: "Gateway Timeout",
};

export function statusTextForCode(code) {
  return STATUS_TEXTS[code] || "";
}

export function installFetch() {
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
}
