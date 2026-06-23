// Minimal CJS compatibility layer for the sandbox.

import { Buffer } from "node:buffer";
import { createRequire as denoCreateRequire } from "node:module";
import { builtinModules } from "node:module";

const nodeRequire = denoCreateRequire(import.meta.url);
const builtins = new Set(builtinModules);

// Modules that could escape the sandbox proxy layer or provide capabilities
// that should be denied at the module level (not just at runtime).
const BLOCKED_BUILTINS = new Set([
  "vm",              // runInThisContext/runInNewContext bypasses shim proxies
  "child_process",   // spawn blocked by --deny-run, but fail at require for clarity
  "cluster",         // spawns workers via child_process
  "worker_threads",  // new V8 isolate without shim proxies
  "v8",              // heap snapshots, serialization internals
  "inspector",       // debugger protocol access
]);

/** Create a synchronous require() that provides sandbox-available modules. */
export function createRequire(
  ldaptsProxy: { Client: unknown; Change: unknown; Attribute: unknown },
  nodeBuffer: typeof Buffer,
  processShim: unknown,
  httpShim: unknown,
  httpsShim: unknown,
) {
  return function require(moduleName: string): unknown {
    switch (moduleName) {
      case "ldapts":
        return ldaptsProxy;
      case "buffer":
        return { Buffer: nodeBuffer };
      case "process":
      case "node:process":
        return processShim;
      case "os":
      case "node:os":
        return {
          homedir: () => "/tmp",
          platform: () => "linux",
          release: () => "0.0.0",
          type: () => "Linux",
          arch: () => "x64",
          tmpdir: () => "/tmp",
          hostname: () => "sandbox",
          EOL: "\n",
        };
      case "http":
      case "node:http":
        return httpShim;
      case "https":
      case "node:https":
        return httpsShim;
      default:
        // Deno supports node: built-ins via its Node compat layer.
        // Delegate any node:* or bare built-in name to Deno's require.
        if (moduleName.startsWith("node:") || builtins.has(moduleName)) {
          const bare = moduleName.replace(/^node:/, "");
          if (BLOCKED_BUILTINS.has(bare)) {
            throw new Error(
              `Module "${moduleName}" is not available in the sandbox.`,
            );
          }
          return nodeRequire(moduleName);
        }
        throw new Error(
          `Module "${moduleName}" is not available in the secured sandbox. ` +
          `Only Node.js built-in modules and sandbox APIs (fetch, crypto, ldapts) are supported.`,
        );
    }
  };
}
