// JSON-RPC 2.0 IPC layer for communication with the Go worker.

import type { RPCRequest, RPCResponse } from "./types.ts";

export interface IPC {
  rpcCall: (method: string, params: Record<string, unknown>) => Promise<RPCResponse>;
  readResponses: () => Promise<void>;
  close: () => Promise<void>;
}

/** Async generator that yields complete lines from a byte stream. */
export async function* readLines(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.trim()) yield line;
      idx = buffer.indexOf("\n");
    }
  }
}

/**
 * Create an IPC instance.
 *
 * Uses writeSync on the request file to bypass WritableStream buffering,
 * ensuring bytes hit the OS pipe immediately.
 */
export function createIPC(
  responseReader: ReadableStreamDefaultReader<Uint8Array>,
  requestFile: Deno.FsFile,
  logError: (message: string) => void,
): IPC {
  const encoder = new TextEncoder();

  const pendingCalls = new Map<string, {
    resolve: (value: RPCResponse) => void;
    reject: (error: Error) => void;
  }>();

  let idCounter = 0;

  function nextId(): string {
    return String(++idCounter);
  }

  async function readResponses(): Promise<void> {
    try {
      for await (const line of readLines(responseReader)) {
        try {
          const resp: RPCResponse = JSON.parse(line);
          const pending = pendingCalls.get(resp.id);
          if (pending) {
            pendingCalls.delete(resp.id);
            pending.resolve(resp);
          }
        } catch (e) {
          // Malformed response — log and skip. Throwing here would kill the
          // response loop, causing all future rpcCall() promises to hang.
          logError(`malformed IPC response (skipping): ${(e as Error).message}`);
        }
      }
    } catch {
      // fd closed — reject all pending calls.
      for (const [, pending] of pendingCalls) {
        pending.reject(new Error("IPC channel closed"));
      }
      pendingCalls.clear();
    }
  }

  async function rpcCall(method: string, params: Record<string, unknown>): Promise<RPCResponse> {
    const id = nextId();
    const request: RPCRequest = { jsonrpc: "2.0", method, params, id };

    const promise = new Promise<RPCResponse>((resolve, reject) => {
      pendingCalls.set(id, { resolve, reject });
    });

    const line = JSON.stringify(request) + "\n";
    requestFile.writeSync(encoder.encode(line));

    return promise;
  }

  async function close(): Promise<void> {
    try { requestFile.close(); } catch { /* ignore */ }
    try { responseReader.cancel(); } catch { /* ignore */ }
  }

  return { rpcCall, readResponses, close };
}
