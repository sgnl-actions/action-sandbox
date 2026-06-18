// Minimal CJS compatibility layer for the sandbox.

import { Buffer } from "node:buffer";

/** Create a synchronous require() that provides sandbox-available modules. */
export function createRequire(
  ldaptsProxy: { Client: unknown; Change: unknown; Attribute: unknown },
  nodeBuffer: typeof Buffer,
) {
  return function require(moduleName: string): unknown {
    switch (moduleName) {
      case "ldapts":
        return ldaptsProxy;
      case "buffer":
      case "node:buffer":
        return { Buffer: nodeBuffer };
      default:
        throw new Error(
          `Module "${moduleName}" is not available in the secured sandbox. ` +
          `Only built-in sandbox APIs (fetch, crypto, ldapts) are supported.`,
        );
    }
  };
}
