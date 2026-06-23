// Structured logging for the sandbox — writes JSON to stderr.

/** Create a console-like object that emits structured JSON log entries. */
export function createConsole(
  jobId: string,
  tenantId: string,
  clientId: string,
  jobType: string,
  workflowId: string,
  write: (data: Uint8Array) => void = (d) => Deno.stderr.writeSync(d),
) {
  const encoder = new TextEncoder();

  function emit(level: string, args: unknown[]) {
    const entry: Record<string, unknown> = {
      timestamp: Date.now(),
      level,
      type: "user",
      jobId,
      tenantId,
      clientId,
      jobType,
      message: args,
    };
    if (workflowId) {
      entry.workflowId = workflowId;
    }
    const line = JSON.stringify(entry) + "\n";
    write(encoder.encode(line));
  }

  return {
    log: (...args: unknown[]) => emit("info", args),
    info: (...args: unknown[]) => emit("info", args),
    warn: (...args: unknown[]) => emit("warn", args),
    error: (...args: unknown[]) => emit("error", args),
    debug: (...args: unknown[]) => emit("debug", args),
  };
}
