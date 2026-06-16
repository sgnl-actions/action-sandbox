let ldapts;

async function getLdapts() {
  if (!ldapts) {
    ldapts = await import('ldapts');
  }
  return ldapts;
}

export function createLdapHandler({ ClientImpl = null, ChangeImpl = null, AttributeImpl = null, fixtures = null } = {}) {
  // Fixture mode: serve responses matched by operation type.
  // Each operation type maintains its own list; successive calls to the same
  // operation advance through the list, and once exhausted the last fixture
  // is replayed (matching the Jest mock fallback behavior).
  if (fixtures) {
    // Group fixtures by operation
    const fixturesByOp = {};
    const counters = {};
    for (const f of fixtures) {
      const op = f.operation;
      if (!fixturesByOp[op]) fixturesByOp[op] = [];
      fixturesByOp[op].push(f);
      counters[op] = 0;
    }

    function getFixtureForOp(operation) {
      const list = fixturesByOp[operation];
      if (!list || list.length === 0) return null;
      const idx = counters[operation];
      if (idx < list.length) {
        counters[operation]++;
        return list[idx];
      }
      // Replay the last fixture for this operation
      return list[list.length - 1];
    }

    function buildSearchResponse(fixture) {
      const rawEntries = fixture.searchEntries || fixture.entries || [];
      const entries = rawEntries.map(entry => {
        if (entry.attributes) {
          return { dn: entry.dn, ...entry.attributes };
        }
        return entry;
      });
      return {
        searchEntries: entries,
        searchReferences: fixture.searchReferences || [],
      };
    }

    return async function handleLdapWithFixtures(params) {
      const { operation } = params;

      if (!operation) {
        return { error: { code: -32602, message: 'Missing required parameter: operation' } };
      }

      // bind/unbind always succeed if no fixture defined for them
      if (operation === 'bind') {
        const fixture = getFixtureForOp('bind');
        if (fixture && fixture.result === 'error') {
          return {
            error: {
              code: fixture.code || 49,
              message: fixture.message || 'Bind failed',
            },
          };
        }
        return { success: true };
      }

      if (operation === 'unbind') {
        getFixtureForOp('unbind'); // consume counter but always succeed
        return { success: true };
      }

      // For other operations, get the next fixture for this operation type
      const fixture = getFixtureForOp(operation);
      if (!fixture) {
        return { error: { code: -32001, message: `No LDAP fixture defined for operation: ${operation}` } };
      }

      if (fixture.result === 'error') {
        return {
          error: {
            code: fixture.code || -32603,
            message: fixture.message || fixture.error?.message || 'LDAP operation failed',
          },
        };
      }

      // Success responses
      switch (operation) {
        case 'search':
          return buildSearchResponse(fixture);
        case 'modify':
        case 'add':
        case 'delete':
        case 'modifyDN':
        case 'compare':
          return { success: true };
        default:
          return { error: { code: -32601, message: `Unknown LDAP operation: ${operation}` } };
      }
    };
  }

  // Mock mode (no fixtures, no real ldapts): return default responses
  // Used when action makes LDAP calls but no fixtures were defined
  if (!ClientImpl) {
    return async function handleLdapMock(params) {
      const { operation } = params;
      if (!operation) {
        return { error: { code: -32602, message: 'Missing required parameter: operation' } };
      }
      switch (operation) {
        case 'bind':
        case 'unbind':
        case 'modify':
        case 'add':
        case 'delete':
        case 'modifyDN':
        case 'compare':
          return { success: true };
        case 'search':
          return { searchEntries: [], searchReferences: [] };
        default:
          return { error: { code: -32601, message: `Unknown LDAP operation: ${operation}` } };
      }
    };
  }
  const clients = new Map();

  async function getOrCreateClient(url, tlsOptions, timeout, connectTimeout) {
    if (!url) {
      throw new Error('Missing required parameter: url');
    }

    let client = clients.get(url);
    if (!client) {
      const Impl = ClientImpl || (await getLdapts()).Client;
      client = new Impl({
        url,
        tlsOptions: tlsOptions || {},
        timeout: timeout || 0,
        connectTimeout: connectTimeout || 0,
      });
      clients.set(url, client);
    }
    return client;
  }

  return async function handleLdap(params) {
    const { operation, url, tlsOptions, timeout, connectTimeout, ...rest } = params;

    if (!operation) {
      return { error: { code: -32602, message: 'Missing required parameter: operation' } };
    }

    try {
      switch (operation) {
        case 'bind': {
          const client = await getOrCreateClient(url, tlsOptions, timeout, connectTimeout);
          await client.bind(rest.dn, rest.password);
          return { success: true };
        }

        case 'unbind': {
          const client = clients.get(url);
          if (client) {
            await client.unbind();
            clients.delete(url);
          }
          return { success: true };
        }

        case 'search': {
          const client = clients.get(url);
          if (!client) {
            return { error: { code: -32600, message: 'No active connection. Call bind first.' } };
          }
          const { baseDN, ...searchOpts } = rest;
          const result = await client.search(baseDN, searchOpts);
          return {
            searchEntries: result.searchEntries,
            searchReferences: result.searchReferences,
          };
        }

        case 'modify': {
          const client = clients.get(url);
          if (!client) {
            return { error: { code: -32600, message: 'No active connection. Call bind first.' } };
          }
          const Change = ChangeImpl || (await getLdapts()).Change;
          const Attribute = AttributeImpl || (await getLdapts()).Attribute;
          const changes = (rest.changes || []).map(c => new Change({
            operation: c.operation,
            modification: new Attribute({
              type: c.modification.type,
              values: c.modification.values || [],
            }),
          }));
          await client.modify(rest.dn, changes);
          return { success: true };
        }

        case 'add': {
          const client = clients.get(url);
          if (!client) {
            return { error: { code: -32600, message: 'No active connection. Call bind first.' } };
          }
          await client.add(rest.dn, rest.attributes);
          return { success: true };
        }

        case 'delete': {
          const client = clients.get(url);
          if (!client) {
            return { error: { code: -32600, message: 'No active connection. Call bind first.' } };
          }
          await client.del(rest.dn);
          return { success: true };
        }

        case 'modifyDN': {
          const client = clients.get(url);
          if (!client) {
            return { error: { code: -32600, message: 'No active connection. Call bind first.' } };
          }
          await client.modifyDN(rest.dn, rest.newDN);
          return { success: true };
        }

        default:
          return { error: { code: -32601, message: `Unknown LDAP operation: ${operation}` } };
      }
    } catch (err) {
      return {
        error: {
          code: err.code || -32603,
          message: err.message || 'LDAP operation failed',
        },
      };
    }
  };
}

export const handleLdap = createLdapHandler();
