// transport.js — Stdin/stdout line I/O and JSON-RPC for sandbox host communication.

export const encoder = new TextEncoder();
const decoder = new TextDecoder();

let readBuffer = "";
const stdinBuf = new Uint8Array(4096);

/**
 * Read a single line from stdin (blocking).
 */
export function readLineSync() {
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
export function writeLine(str) {
  Deno.stdout.writeSync(encoder.encode(str + "\n"));
}

let requestId = 0;

/**
 * Send a JSON-RPC request to the host via stdout and read response from stdin.
 */
export async function rpcCall(method, params) {
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
