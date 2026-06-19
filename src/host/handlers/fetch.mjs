let fixtureMap = new Map(); // key: "METHOD url" -> array of {response, persist}

/**
 * Set up in-memory fixture interceptors from fixture data.
 */
export function setupFetchFixtures(fixtures) {
  fixtureMap = new Map();

  if (!fixtures || fixtures.length === 0) return;

  for (const fixture of fixtures) {
    const { request, response } = fixture;
    const method = request.method.toUpperCase();
    const key = `${method} ${request.url}`;

    const statusCode = response.statusCode || response.status || 200;
    const entry = {
      response,
      statusCode,
      persist: !!(response.networkError || statusCode >= 400),
    };

    if (!fixtureMap.has(key)) {
      fixtureMap.set(key, []);
    }
    fixtureMap.get(key).push(entry);
  }
}

/**
 * Clean up all fixture interceptors.
 */
export function cleanupFetchFixtures() {
  fixtureMap = new Map();
}

/**
 * Handle a fetch RPC request by matching against fixtures directly.
 */
export function handleFetch(params) {
  const { url, method = 'GET', headers = {}, body } = params;

  if (!url) {
    return { error: { code: -32602, message: 'Missing required parameter: url' } };
  }

  const key = `${method.toUpperCase()} ${url}`;
  const entries = fixtureMap.get(key);

  if (!entries || entries.length === 0) {
    return { error: { code: -32000, message: `No fixture matched: ${key}` } };
  }

  const entry = entries[0];

  // Consume non-persistent fixtures (success responses)
  if (!entry.persist) {
    entries.shift();
  }

  const { response } = entry;

  if (response.networkError) {
    return { error: { code: -32000, message: 'Network error: connection refused' } };
  }

  // Encode body as base64 if present
  let respBody;
  if (response.body) {
    respBody = typeof response.body === 'string'
      ? Buffer.from(response.body).toString('base64')
      : Buffer.from(JSON.stringify(response.body)).toString('base64');
  }

  return {
    status: entry.statusCode,
    headers: response.headers || {},
    body: respBody,
  };
}
