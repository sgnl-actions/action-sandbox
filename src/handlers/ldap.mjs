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
    let pendingBindError = null;

    for (const f of fixtures) {
      const op = f.operation;
      if (!fixturesByOp[op]) fixturesByOp[op] = [];
      fixturesByOp[op].push(f);
      counters[op] = 0;
    }

    // Process bind fixtures: if any bind fixture has result === 'error',
    // store it as pendingBindError (simulates auth failure on first real op)
    if (fixturesByOp['bind']) {
      for (const f of fixturesByOp['bind']) {
        if (f.result === 'error') {
          pendingBindError = {
            code: f.code || 49,
            message: f.message || 'Bind failed',
          };
          break;
        }
      }
      delete fixturesByOp['bind'];
    }
    // Remove unbind fixtures — they have no meaning in the production spec
    delete fixturesByOp['unbind'];

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

      // If there's a pending bind error, return it on the first real operation
      if (pendingBindError) {
        const err = pendingBindError;
        pendingBindError = null;
        return { error: err };
      }

      // For operations, get the next fixture for this operation type
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

  // Passthrough mode: each operation creates a fresh client, binds, performs
  // the operation, and unbinds. The host manages the full lifecycle per-call (stateless).
  return async function handleLdap(params) {
    const { operation, url, bindDN, bindPassword, ...rest } = params;

    if (!operation) {
      return { error: { code: -32602, message: 'Missing required parameter: operation' } };
    }

    if (!url) {
      return { error: { code: -32602, message: 'Missing required parameter: url' } };
    }

    let client;
    try {
      const Impl = ClientImpl || (await getLdapts()).Client;
      client = new Impl({ url, tlsOptions: {}, timeout: 0, connectTimeout: 0 });

      // Bind with provided credentials
      if (bindDN) {
        await client.bind(bindDN, bindPassword || '');
      }

      switch (operation) {
        case 'search': {
          const { baseDN, ...searchOpts } = rest;
          const result = await client.search(baseDN, searchOpts);
          return {
            searchEntries: result.searchEntries,
            searchReferences: result.searchReferences,
          };
        }

        case 'modify': {
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
          await client.add(rest.dn, rest.attributes_entry || rest.attributes);
          return { success: true };
        }

        case 'delete': {
          await client.del(rest.dn);
          return { success: true };
        }

        case 'modifyDN': {
          await client.modifyDN(rest.dn, rest.newDN);
          return { success: true };
        }

        case 'compare': {
          const result = await client.compare(rest.dn, rest.attribute, rest.value);
          return { success: true, result };
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
    } finally {
      if (client) {
        try { await client.unbind(); } catch (_) { /* ignore unbind errors */ }
      }
    }
  };
}

export const handleLdap = createLdapHandler();
