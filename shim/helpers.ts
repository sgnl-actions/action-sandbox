// Utility functions for stdin/stdout I/O.

const encoder = new TextEncoder();

/** Read all bytes from a readable stream. */
export async function readAllStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/** Write a JSON result to a writer as a newline-terminated string. */
export function writeResult(
  result: Record<string, unknown>,
  write: (data: Uint8Array) => void = (d) => Deno.stdout.writeSync(d),
): void {
  const line = JSON.stringify(result) + "\n";
  write(encoder.encode(line));
}
