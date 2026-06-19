import { signJWT } from './handlers/jwt.mjs';
import { handleHttp } from './handlers/http.mjs';

export function createRPCDispatcher(fetchHandler, ldapHandler) {
  return function dispatch(method, params) {
    switch (method) {
      case 'fetch':
        return fetchHandler(params);
      case 'http':
        return handleHttp(params);
      case 'signJWT':
        return signJWT(params);
      case 'ldap':
        return ldapHandler(params);
      default:
        return { error: { code: -32601, message: `Method not found: ${method}` } };
    }
  };
}
