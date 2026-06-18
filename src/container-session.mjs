import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const DEFAULT_IMAGE = 'ghcr.io/sgnl-actions/sandbox-runner:latest';

/**
 * Manages a long-lived Docker container that runs action bundles through
 * the production Deno shim. One container stays alive for the entire test
 * session; scenarios are streamed via NDJSON on stdin/stdout.
 */
export class ContainerSession {
  #process = null;
  #iterator = null;
  #image;
  #started = false;

  constructor({ image } = {}) {
    this.#image = image || process.env.SANDBOX_IMAGE || DEFAULT_IMAGE;
  }

  /**
   * Start the container. Must be called before run().
   */
  async start() {
    if (this.#started) return;

    this.#process = spawn('docker', ['run', '--rm', '-i', this.#image], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Drain container stderr to prevent backpressure
    this.#process.stderr.setEncoding('utf8');
    this.#process.stderr.on('data', () => {});

    const rl = createInterface({ input: this.#process.stdout });
    this.#iterator = rl[Symbol.asyncIterator]();
    this.#started = true;

    // Wait briefly for the container to be ready (or fail immediately)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      this.#process.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start container: ${err.message}`));
      });
      this.#process.on('close', (code) => {
        if (!this.#started) return;
        clearTimeout(timer);
        if (code !== 0 && code !== null) {
          reject(new Error(`Container exited immediately with code ${code}`));
        }
      });
    });
  }

  /**
   * Run a single scenario in the container.
   *
   * @param {object} scenario
   * @param {object} scenario.payload - { script, inputs, secrets, outputs, environment, data, metadata, timeout }
   * @param {object} [scenario.fixtures] - { http: [...], ldap: [...] }
   * @param {boolean} [scenario.verbose] - Forward RPC debug output
   * @returns {Promise<object>} The result from the container
   */
  async run(scenario) {
    if (!this.#started) {
      throw new Error('ContainerSession not started. Call start() first.');
    }

    const message = { type: 'run', ...scenario };
    this.#process.stdin.write(JSON.stringify(message) + '\n');

    // Read the next line from container stdout
    const { value, done } = await this.#iterator.next();

    if (done || !value) {
      throw new Error('Container closed stdout without returning a result');
    }

    return JSON.parse(value);
  }

  /**
   * Shut down the container gracefully.
   */
  async close() {
    if (!this.#started || !this.#process) return;
    this.#started = false;

    this.#process.stdin.write('{"type":"done"}\n');
    this.#process.stdin.end();

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#process.kill('SIGTERM');
        resolve();
      }, 5000);
      this.#process.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

/**
 * Check that Docker is available and the sandbox image exists.
 * Throws a descriptive error if either check fails.
 *
 * @param {string} [image] - Image name to check (defaults to DEFAULT_IMAGE)
 */
export function checkDocker(image) {
  const img = image || process.env.SANDBOX_IMAGE || DEFAULT_IMAGE;

  try {
    execFileSync('docker', ['version'], { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Docker is required to run sandbox tests.\n' +
      '  Install: https://docs.docker.com/get-docker/\n' +
      '  Then pull the image: docker pull ' + img
    );
  }

  try {
    execFileSync('docker', ['image', 'inspect', img], { stdio: 'pipe' });
  } catch {
    throw new Error(
      `Sandbox container image not found: ${img}\n` +
      `  Pull it: docker pull ${img}\n` +
      `  Or build locally: cd action-sandbox && docker build -t ${img} .`
    );
  }
}
