// Deno Sandbox Shim — Entry point for isolated job execution.
//
// This script runs inside a Deno subprocess with OS-level capabilities denied.
// The Go worker spawns Deno with flags like:
//   --deny-net --deny-run --deny-env
//   --allow-read=/dev/fd/3 --allow-write=/dev/fd/4
//   --no-prompt --cached-only --v8-flags=--max-old-space-size=64
//
// All external communication (HTTP, JWT signing, LDAP) is proxied through the Go
// worker via pipe-based JSON-RPC 2.0 IPC:
//   - fd 3: Go → Deno (responses from the Go worker)
//   - fd 4: Deno → Go (requests to the Go worker)
//
// Payload is delivered via stdin as a single JSON object.
// Result is written to stdout as a single JSON line on completion.

import { Buffer } from "node:buffer";
import type { Payload } from "./types.ts";
import { createIPC } from "./ipc.ts";
import { createProxiedFetch, createProxiedCrypto, createLdaptsProxy } from "./callbacks.ts";
import { createConsole } from "./console.ts";
import { createRequire } from "./require.ts";
import { createHttpShim } from "./http-shim.ts";
import { readAllStream, writeResult } from "./helpers.ts";

const encoder = new TextEncoder();

/** Emit a structured infrastructure log to stderr. */
function logInfraError(message: string): void {
  const entry = JSON.stringify({
    timestamp: Date.now(),
    level: "error",
    type: "infrastructure",
    message,
  }) + "\n";
  Deno.stderr.writeSync(encoder.encode(entry));
}

async function main(): Promise<void> {
  // Open inherited file descriptors for IPC with the Go worker.
  const fd3 = Deno.openSync("/dev/fd/3", { read: true });
  const fd4 = Deno.openSync("/dev/fd/4", { write: true });

  const ipc = createIPC(
    fd3.readable.getReader(),
    fd4,
    logInfraError,
  );

  // Start reading responses in the background.
  const responseLoop = ipc.readResponses();

  // Read payload from stdin (Go closes stdin after writing).
  const stdinBytes = await readAllStream(Deno.stdin.readable.getReader());
  const payloadStr = new TextDecoder().decode(stdinBytes);

  let payload: Payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (e) {
    writeResult({ success: false, error: `Failed to parse stdin payload: ${(e as Error).message}` });
    Deno.exit(1);
  }

  const {
    script,
    inputs,
    secrets,
    outputs,
    environment,
    data,
    metadata,
    timeout,
    jobId,
    tenantId,
    clientId,
    jobType,
    workflowId,
  } = payload;

  // Set up timeout enforcement (backup — Go also enforces via SIGTERM).
  const timeoutId = setTimeout(() => {
    writeResult({ success: false, error: "Script execution timeout", timeout: true });
    Deno.exit(1);
  }, timeout);

  // Create sandbox APIs.
  const sandboxConsole = createConsole(jobId, tenantId, clientId, jobType, workflowId || "");
  const proxiedFetch = createProxiedFetch(ipc.rpcCall, metadata);
  const proxiedCrypto = createProxiedCrypto(ipc.rpcCall);
  const ldaptsProxy = createLdaptsProxy(ipc.rpcCall, metadata);

  // Restricted process object matching sandbox.js contract (needed by AWS SDK and others).
  const processShim = {
    env: {},
    cwd: () => "/app",
    version: "v22.0.0",
    versions: { node: "22.0.0" },
    hrtime: () => [0, 0],
    emitWarning: () => {},
    geteuid: () => 1000,
  };

  const requireFn = createRequire(
    ldaptsProxy, Buffer, processShim,
    createHttpShim(proxiedFetch, "http:"),
    createHttpShim(proxiedFetch, "https:"),
  );

  // Create CJS module wrapper.
  const moduleObj = { exports: {} as Record<string, unknown> };
  const exportsObj = moduleObj.exports;

  try {
    // Wrap the CJS bundle in a function that injects sandbox globals,
    // shadowing any Deno globals the script might try to access.
    const paramNames = [
      "module", "exports", "require", "console", "fetch", "crypto", "Buffer",
      "setTimeout", "setInterval", "clearTimeout", "clearInterval",
      "Promise", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
      "AbortController", "AbortSignal", "btoa", "atob",
      "Object", "Array", "String", "Number", "Boolean", "Date", "Math", "JSON",
      "parseInt", "parseFloat", "isNaN", "isFinite",
      "encodeURIComponent", "decodeURIComponent", "structuredClone",
      "Headers", "Request", "Response",
      "inputs", "outputs", "secrets", "environment", "data",
      "process", "Deno", "globalThis",
    ];

    // Restricted globalThis that provides only safe globals (no Deno, no real process).
    const sandboxGlobalThis = {
      setTimeout: globalThis.setTimeout,
      setInterval: globalThis.setInterval,
      clearTimeout: globalThis.clearTimeout,
      clearInterval: globalThis.clearInterval,
      Promise: globalThis.Promise,
      URL: globalThis.URL,
      URLSearchParams: globalThis.URLSearchParams,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
      AbortController: globalThis.AbortController,
      AbortSignal: globalThis.AbortSignal,
      btoa: globalThis.btoa,
      atob: globalThis.atob,
      Object: globalThis.Object,
      Array: globalThis.Array,
      String: globalThis.String,
      Number: globalThis.Number,
      Boolean: globalThis.Boolean,
      Date: globalThis.Date,
      Math: globalThis.Math,
      JSON: globalThis.JSON,
      parseInt: globalThis.parseInt,
      parseFloat: globalThis.parseFloat,
      isNaN: globalThis.isNaN,
      isFinite: globalThis.isFinite,
      encodeURIComponent: globalThis.encodeURIComponent,
      decodeURIComponent: globalThis.decodeURIComponent,
      structuredClone: globalThis.structuredClone,
      Headers: globalThis.Headers,
      Request: globalThis.Request,
      Response: globalThis.Response,
      Buffer,
      console: sandboxConsole,
      fetch: proxiedFetch,
      crypto: proxiedCrypto,
      process: processShim,
    };

    const paramValues = [
      moduleObj, exportsObj, requireFn, sandboxConsole, proxiedFetch, proxiedCrypto, Buffer,
      globalThis.setTimeout, globalThis.setInterval, globalThis.clearTimeout, globalThis.clearInterval,
      globalThis.Promise, globalThis.URL, globalThis.URLSearchParams, globalThis.TextEncoder, globalThis.TextDecoder,
      globalThis.AbortController, globalThis.AbortSignal, globalThis.btoa, globalThis.atob,
      globalThis.Object, globalThis.Array, globalThis.String, globalThis.Number, globalThis.Boolean,
      globalThis.Date, globalThis.Math, globalThis.JSON,
      globalThis.parseInt, globalThis.parseFloat, globalThis.isNaN, globalThis.isFinite,
      globalThis.encodeURIComponent, globalThis.decodeURIComponent, globalThis.structuredClone,
      globalThis.Headers, globalThis.Request, globalThis.Response,
      inputs || {}, outputs || {}, secrets || {}, environment || {}, data || {},
      processShim, undefined, sandboxGlobalThis,
    ];

    const wrappedScript = `(function(${paramNames.join(", ")}) {\n${script}\n})`;

    // deno-lint-ignore no-eval
    const scriptFn = eval(wrappedScript);
    scriptFn(...paramValues);

    // Get the invoke handler from module.exports.
    const invokeHandler = moduleObj.exports.invoke;
    if (typeof invokeHandler !== "function") {
      clearTimeout(timeoutId);
      writeResult({ success: false, error: "No invoke handler found in script" });
      Deno.exit(1);
    }

    // Call invoke with inputs and context (matches existing sandbox.js contract).
    const context = {
      outputs: outputs || {},
      secrets: secrets || {},
      environment: environment || {},
      data: data || {},
      crypto: proxiedCrypto,
    };

    const result = await (invokeHandler as (params: unknown, ctx: unknown) => Promise<unknown>)(
      inputs || {},
      context,
    );

    clearTimeout(timeoutId);
    writeResult({ success: true, data: result });
  } catch (error) {
    clearTimeout(timeoutId);

    // Attempt to call error handler if one exists.
    const errorHandler = moduleObj.exports.error;
    if (typeof errorHandler === "function") {
      try {
        const errorResult = await (errorHandler as (params: unknown, ctx: unknown) => Promise<unknown>)(
          {
            error: {
              message: (error as Error).message || String(error),
              code: (error as Record<string, unknown>).code || "SCRIPT_ERROR",
              stack: (error as Error).stack,
              name: (error as Error).name,
            },
          },
          {
            outputs: outputs || {},
            secrets: secrets || {},
            environment: environment || {},
            data: data || {},
            crypto: proxiedCrypto,
          },
        );

        writeResult({
          success: false,
          error: (error as Error).message || String(error),
          data: errorResult,
        });
        Deno.exit(1);
      } catch {
        // Error handler itself failed — fall through.
      }
    }

    writeResult({ success: false, error: (error as Error).message || String(error) });
    Deno.exit(1);
  }

  // Clean up IPC.
  await ipc.close();
  await responseLoop.catch(() => {});

  Deno.exit(0);
}

// --- Entry Point ---

main().catch((e) => {
  writeResult({ success: false, error: `Shim fatal error: ${(e as Error).message}` });
  Deno.exit(1);
});
