export function createFetchHandler(fixtures) {
  const queue = fixtures ? [...fixtures] : [];

  return function handleFetch(params) {
    const { url, method = 'GET' } = params;

    if (!url) {
      return { error: { code: -32602, message: 'Missing required parameter: url' } };
    }

    const idx = queue.findIndex(
      (f) => f.request.method === method && f.request.url === url,
    );

    if (idx !== -1) {
      const fixture = queue.splice(idx, 1)[0];

      if (fixture.response.networkError) {
        return { error: { code: -32000, message: 'Network error: connection refused' } };
      }

      return {
        status: fixture.response.statusCode || fixture.response.status || 200,
        headers: fixture.response.headers || {},
        body: fixture.response.body
          ? Buffer.from(fixture.response.body).toString('base64')
          : undefined,
      };
    }

    return { error: { code: -32001, message: `No fixture matched: ${method} ${url}` } };
  };
}
