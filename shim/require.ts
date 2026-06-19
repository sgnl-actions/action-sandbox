// Minimal CJS compatibility layer for the sandbox.

import { Buffer } from "node:buffer";
import { createRequire as denoCreateRequire } from "node:module";
import { builtinModules } from "node:module";

const nodeRequire = denoCreateRequire(import.meta.url);
const builtins = new Set(builtinModules);

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
          return nodeRequire(moduleName);
        }
        throw new Error(
          `Module "${moduleName}" is not available in the secured sandbox. ` +
          `Only Node.js built-in modules and sandbox APIs (fetch, crypto, ldapts) are supported.`,
        );
    }
  };
}
