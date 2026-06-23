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

const tBoot = performance.now();

import { Buffer } from "node:buffer";
import type { Payload } from "./types.ts";
import { createIPC } from "./ipc.ts";
import { createProxiedFetch, createProxiedCrypto, createLdaptsProxy, createProxiedHttp } from "./callbacks.ts";
import { createConsole } from "./console.ts";
import { createRequire } from "./require.ts";
import { readAllStream, writeResult } from "./helpers.ts";

const encoder = new TextEncoder();

/** Emit a structured infrastructure log to stderr. */
function logInfraError(message: string): void {
  const entry =
    JSON.stringify({
      timestamp: Date.now(),
      level: "error",
      type: "infrastructure",
      message
    }) + "\n";
  Deno.stderr.writeSync(encoder.encode(entry));
}

async function main(): Promise<void> {
  const t0 = performance.now();

  // Open inherited file descriptors for IPC with the Go worker.
  const fd3 = Deno.openSync("/dev/fd/3", { read: true });
  const fd4 = Deno.openSync("/dev/fd/4", { write: true });

  const ipc = createIPC(fd3.readable.getReader(), fd4, logInfraError);

  // Start reading responses in the background.
  const responseLoop = ipc.readResponses();

  const t1 = performance.now();

  // Read payload from stdin (Go closes stdin after writing).
  const stdinBytes = await readAllStream(Deno.stdin.readable.getReader());
  const payloadStr = new TextDecoder().decode(stdinBytes);

  const t2 = performance.now();

  let payload: Payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch (e) {
    writeResult({ success: false, error: `Failed to parse stdin payload: ${(e as Error).message}` });
    Deno.exit(1);
  }

  const t3 = performance.now();

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
    workflowId
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
  const proxiedHttp = createProxiedHttp(ipc.rpcCall, metadata, "http:");
  const proxiedHttps = createProxiedHttp(ipc.rpcCall, metadata, "https:");

  // Restricted process object matching sandbox.js contract (needed by AWS SDK and others).
  const processShim = {
    env: {},
    cwd: () => "/app",
    version: "v22.0.0",
    versions: { node: "22.0.0" },
    hrtime: () => [0, 0],
    emitWarning: () => {},
    geteuid: () => 1000
  };

  const requireFn = createRequire(ldaptsProxy, Buffer, processShim, proxiedHttp, proxiedHttps);

  // Create CJS module wrapper.
  const moduleObj = { exports: {} as Record<string, unknown> };
  const exportsObj = moduleObj.exports;

  const t4 = performance.now();
  try {
    // Proxy-based globalThis: overrides dangerous/proxied APIs, blocks known-unsafe
    // globals, and passes everything else through to the real globalThis.
    const blockedGlobals = new Set(["Deno", "WebSocket", "Worker", "SharedWorker", "BroadcastChannel"]);
    const overrides: Record<string, unknown> = {
      fetch: proxiedFetch,
      crypto: proxiedCrypto,
      process: processShim,
      console: sandboxConsole,
      Buffer
    };
    const sandboxGlobalThis: typeof globalThis = new Proxy(globalThis, {
      get(target, prop) {
        if (prop === "globalThis") return sandboxGlobalThis;
        if (Object.hasOwn(overrides, prop as string)) return overrides[prop as string];
        if (blockedGlobals.has(prop as string)) return undefined;
        return (target as Record<string | symbol, unknown>)[prop];
      }
    }) as typeof globalThis;

    // Wrap the CJS bundle in a function that injects sandbox globals,
    // shadowing any Deno globals the script might try to access.
    const paramNames = [
      "module",
      "exports",
      "require",
      "console",
      "fetch",
      "crypto",
      "Buffer",
      "process",
      "Deno",
      "globalThis"
    ];

    const paramValues = [
      moduleObj,
      exportsObj,
      requireFn,
      sandboxConsole,
      proxiedFetch,
      proxiedCrypto,
      Buffer,
      processShim,
      undefined,
      sandboxGlobalThis
    ];

    const wrappedScript = `(function(${paramNames.join(", ")}) {\n${script}\n})`;

    // deno-lint-ignore no-eval
    const scriptFn = eval(wrappedScript);

    const t5 = performance.now();

    scriptFn(...paramValues);

    // Get the invoke handler from module.exports.
    const invokeHandler = moduleObj.exports.invoke;
    if (typeof invokeHandler !== "function") {
      clearTimeout(timeoutId);
      writeResult({ success: false, error: "No invoke handler found in script" });
      Deno.exit(1);
    }

    const t6 = performance.now();

    // Call invoke with inputs and context (matches existing sandbox.js contract).
    const context = {
      outputs: outputs || {},
      secrets: secrets || {},
      environment: environment || {},
      data: data || {},
      crypto: proxiedCrypto
    };
    const result = await (invokeHandler as (params: unknown, ctx: unknown) => Promise<unknown>)(inputs || {}, context);

    const t7 = performance.now();

    // Emit timing breakdown to stderr as structured log.
    const timingEntry =
      JSON.stringify({
        timestamp: Date.now(),
        level: "debug",
        type: "infrastructure",
        component: "deno-worker",
        message: `Deno shim timings: bootMs=${+(t0 - tBoot).toFixed(2)} ipcSetupMs=${+(t1 - t0).toFixed(2)} stdinReadMs=${+(t2 - t1).toFixed(2)} jsonParseMs=${+(t3 - t2).toFixed(2)} sandboxSetupMs=${+(t4 - t3).toFixed(2)} evalMs=${+(t5 - t4).toFixed(2)} scriptInitMs=${+(t6 - t5).toFixed(2)} invokeMs=${+(t7 - t6).toFixed(2)} totalMs=${+(t7 - tBoot).toFixed(2)}`
      }) + "\n";
    Deno.stderr.writeSync(encoder.encode(timingEntry));

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
              name: (error as Error).name
            }
          },
          {
            outputs: outputs || {},
            secrets: secrets || {},
            environment: environment || {},
            data: data || {},
            crypto: proxiedCrypto
          }
        );

        writeResult({
          success: false,
          error: (error as Error).message || String(error),
          data: errorResult
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
