import { signJWT } from './handlers/jwt.mjs';

export function createRPCDispatcher(fetchHandler, ldapHandler) {
  return async function dispatch(method, params) {
    switch (method) {
      case 'fetch':
        return await fetchHandler(params);
      case 'signJWT':
        return signJWT(params);
      case 'ldap':
        return ldapHandler(params);
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  };
}
