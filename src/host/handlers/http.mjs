import { handleFetch } from './fetch.mjs';

/**
 * Handle an "http" RPC request by constructing a URL from the raw HTTP params
 * and delegating to the fetch fixture handler.
 */
export function handleHttp(params) {
  const { protocol = 'https:', hostname, port, path = '/', method = 'GET', headers = {}, body } = params;

  if (!hostname) {
    return { error: { code: -32602, message: 'Missing required parameter: hostname' } };
  }

  const scheme = protocol.replace(':', '');
  const portSuffix = port ? `:${port}` : '';
  const url = `${scheme}://${hostname}${portSuffix}${path}`;

  return handleFetch({ url, method, headers, body });
}
