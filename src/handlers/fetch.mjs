/**
 * Creates a fetch handler, optionally backed by fixtures.
 *
 * When `fixtures` is provided, requests are matched against the fixture list
 * (FIFO, consumed on match). Unmatched requests return an error (strict mode).
 *
 * When `fixtures` is null, requests pass through to real HTTP via Node.js fetch.
 *
 * @param {Array|null} fixtures - Array of { request: { method, url }, response: { statusCode, headers, body, networkError } }
 * @returns {Function} Async handler for JSON-RPC fetch calls
 */
export function createFetchHandler(fixtures = null) {
  const fixtureQueue = fixtures ? [...fixtures] : null;

  return async function handleFetch(params) {
    const { url, method = 'GET', headers = {}, body } = params;

    if (!url) {
      return { error: { code: -32602, message: 'Missing required parameter: url' } };
    }

    // Fixture mode
    if (fixtureQueue) {
      const idx = fixtureQueue.findIndex(
        (f) => f.request.method === method && f.request.url === url,
      );

      if (idx !== -1) {
        const fixture = fixtureQueue.splice(idx, 1)[0];

        if (fixture.response.networkError) {
          return {
            error: { code: -32002, message: 'Network error: connection refused' },
          };
        }

        return {
          status: fixture.response.statusCode,
          headers: fixture.response.headers || {},
          body: Buffer.from(fixture.response.body || '').toString('base64'),
        };
      }

      return {
        error: { code: -32001, message: `No fixture matched: ${method} ${url}` },
      };
    }

    // Passthrough mode — real HTTP
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
