/**
 * Normalize a URL for fixture matching.
 * Decodes percent-encoded characters and normalizes space encoding (+/%20)
 * so that equivalent URLs match regardless of encoding style.
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Decode path, and decode query (replacing + with space first, since + means space in query strings)
    const decodedPath = decodeURIComponent(parsed.pathname);
    const decodedQuery = parsed.search
      ? '?' + decodeURIComponent(parsed.search.slice(1).replace(/\+/g, '%20'))
      : '';
    return parsed.origin + decodedPath + decodedQuery;
  } catch {
    return decodeURIComponent(url.replace(/\+/g, '%20'));
  }
}

/**
 * Creates a fetch handler, optionally backed by fixtures.
 *
 * When `fixtures` is provided, requests are matched against the fixture list
 * (FIFO order). Matched fixtures are consumed, but repeated requests to the
 * same method+URL will replay the last consumed fixture (supporting SDK retries).
 * Unmatched requests return an error (strict mode).
 *
 * When `fixtures` is null, requests pass through to real HTTP via Node.js fetch.
 *
 * @param {Array|null} fixtures - Array of { request: { method, url }, response: { statusCode, headers, body, networkError } }
 * @returns {Function} Async handler for JSON-RPC fetch calls
 */
export function createFetchHandler(fixtures = null) {
  const fixtureQueue = fixtures ? [...fixtures] : null;
  // Track last response per method+URL for retry support
  const lastResponse = new Map();

  return async function handleFetch(params) {
    const { url, method = 'GET', headers = {}, body } = params;

    if (!url) {
      return { error: { code: -32602, message: 'Missing required parameter: url' } };
    }

    // Fixture mode
    if (fixtureQueue) {
      const normalizedUrl = normalizeUrl(url);
      const key = `${method} ${normalizedUrl}`;
      const idx = fixtureQueue.findIndex(
        (f) => f.request.method === method && normalizeUrl(f.request.url) === normalizedUrl,
      );

      if (idx !== -1) {
        const fixture = fixtureQueue.splice(idx, 1)[0];

        let response;
        if (fixture.response.networkError) {
          response = {
            error: { code: -32002, message: 'Network error: connection refused' },
          };
        } else {
          response = {
            status: fixture.response.statusCode,
            headers: fixture.response.headers || {},
            body: Buffer.from(fixture.response.body || '').toString('base64'),
          };
        }

        // Cache for retries
        lastResponse.set(key, response);
        return response;
      }

      // No fixture in queue — check if we have a cached response (SDK retry)
      if (lastResponse.has(key)) {
        return lastResponse.get(key);
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
