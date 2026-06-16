/**
 * Creates a fetch handler that passes through to real HTTP via Node.js fetch.
 *
 * @returns {Function} Async handler for JSON-RPC fetch calls
 */
export function createFetchHandler() {
  return async function handleFetch(params) {
    const { url, method = 'GET', headers = {}, body } = params;

    if (!url) {
      return { error: { code: -32602, message: 'Missing required parameter: url' } };
    }

    const fetchOpts = { method, headers };
    if (body) {
      fetchOpts.body = Buffer.from(body, 'base64');
    }

    const response = await fetch(url, fetchOpts);

    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const responseBody = Buffer.from(await response.arrayBuffer()).toString('base64');

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    };
  };
}
