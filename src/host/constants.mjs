export const SHIM_DIR = '/app/deno';
export const BUNDLE_PATH = '/tmp/bundle.js';
export const DENO_BIN = '/usr/bin/deno';
export const FIFO_FD3 = '/tmp/fd3.pipe';
export const FIFO_FD4 = '/tmp/fd4.pipe';

// Size limits matching production Go worker.
export const MAX_RPC_REQUEST_BYTES = 10 * 1024 * 1024;  // 10 MB per RPC message
export const MAX_STDOUT_BYTES = 10 * 1024 * 1024;       // 10 MB total result output
export const MAX_LOG_LINES = 10_000;                     // 10k total log lines
export const MAX_LOG_LINE_BYTES = 16 * 1024;             // 16 KB per log line
