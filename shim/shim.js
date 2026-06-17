// shim.js — Runs inside Deno sandbox.
// Entry point: redirects console, sets up CJS loader, and invokes the bundle handler.
//
// Sandbox transport:
//   - stdin:  reads from host (JSON-RPC responses + init message)
//   - stdout: writes to host (JSON-RPC requests + __RESULT__ tagged final output)
//   - stderr: action console logs

const bundlePath = Deno.args[0];
if (!bundlePath) {
  Deno.stderr.writeSync(new TextEncoder().encode("shim: missing bundle path argument\n"));
  Deno.exit(1);
}

// --- Redirect console to stderr (keep stdout clean for sandbox transport) ---
import { encoder } from "./transport.js";
const writeStderr = (msg) => Deno.stderr.writeSync(encoder.encode(msg));

console.log = (...args) => writeStderr(args.join(" ") + "\n");
console.error = (...args) => writeStderr("[ERROR] " + args.join(" ") + "\n");
console.warn = (...args) => writeStderr("[WARN] " + args.join(" ") + "\n");
console.info = (...args) => writeStderr("[INFO] " + args.join(" ") + "\n");
console.debug = (...args) => writeStderr("[DEBUG] " + args.join(" ") + "\n");

// --- Import shim modules ---
import { readLineSync, writeLine, rpcCall } from "./transport.js";
import { installFetch } from "./fetch-shim.js";
import { httpShim, httpsShim } from "./http-shim.js";
import { ldaptsModule } from "./ldap-shim.js";
import { processShim, osShim } from "./process-shim.js";
import { createRequire } from "node:module";

// --- Install fetch override ---
installFetch();

// --- CJS require shim ---
const nodeRequire = createRequire(import.meta.url);

function shimRequire(specifier) {
  if (specifier === "ldapts") {
    return ldaptsModule;
  }
  if (specifier === "process" || specifier === "node:process") {
    return processShim;
  }
  if (specifier === "os" || specifier === "node:os") {
    return osShim;
  }
  if (specifier === "http" || specifier === "node:http") {
    return httpShim;
  }
  if (specifier === "https" || specifier === "node:https") {
    return httpsShim;
  }
  // Delegate Node.js built-in modules to Deno's Node compatibility layer
  return nodeRequire(specifier);
}

// --- Main execution ---
async function main() {
  try {
    // Read init message from host (first line on stdin)
    const initLine = readLineSync();
    if (!initLine) {
      throw new Error("shim: no init message received from host");
    }
    const initData = JSON.parse(initLine);
    const { handler, params, context: ctx } = initData;

    // Inject context.crypto.signJWT as sandbox-backed function
    // If init message contains crypto mock values, short-circuit without IPC
    const context = {
      ...ctx,
      crypto: {
        ...(ctx.crypto || {}),
        signJWT: async (payload, options) => {
          if (ctx.crypto?.signJWT?.returns) {
            return ctx.crypto.signJWT.returns;
          }
          const result = await rpcCall("signJWT", { payload, options });
          return result.token;
        },
      },
    };

    // Load the bundle
    const bundleCode = await Deno.readTextFile(bundlePath);

    const moduleObj = { exports: {} };
    const wrappedFn = new Function("require", "module", "exports", "process", bundleCode);
    wrappedFn(shimRequire, moduleObj, moduleObj.exports, processShim);

    const bundle = moduleObj.exports;

    if (typeof bundle[handler] !== "function") {
      throw new Error(`Bundle does not export handler: ${handler}`);
    }

    // Call the handler
    const result = await bundle[handler](params, context);

    // Write result to stdout with sentinel prefix
    const output = "__RESULT__" + JSON.stringify({ result });
    writeLine(output);
  } catch (err) {
    const output = "__RESULT__" + JSON.stringify({ error: err.message || String(err) });
    writeLine(output);
  }
}

await main();
