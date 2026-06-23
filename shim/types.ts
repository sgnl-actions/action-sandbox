// Shared type definitions for the Deno sandbox shim.
// RPC types are generated from openrpc.json — see sandboxrpc/sandboxrpc.gen.ts.

export type {
  RPCRequest,
  RPCResponse,
  RPCError,
  FetchParams,
  FetchResult,
  SignJWTParams,
  SignJWTResult,
  LdapParams,
  LdapResult,
} from "./sandboxrpc.gen.ts";

export { RPCErrorCodes } from "./sandboxrpc.gen.ts";

// Payload is the job input delivered via stdin (not part of the RPC schema).
export interface Payload {
  script: string;
  inputs: Record<string, unknown>;
  secrets: Record<string, unknown>;
  outputs: Record<string, unknown>;
  environment: Record<string, unknown>;
  data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  timeout: number; // milliseconds
  jobId: string;
  tenantId: string;
  clientId: string;
  jobType: string;
  workflowId?: string;
}
