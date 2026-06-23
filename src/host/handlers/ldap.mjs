export function createLdapHandler(ldapFixtures) {
  if (!ldapFixtures || ldapFixtures.length === 0) {
    return function handleLdapMock(params) {
      const { operation } = params;
      if (!operation) {
        return { error: { code: -32602, message: 'Missing required parameter: operation' } };
      }
      switch (operation) {
        case 'search':
          return { searchEntries: [], searchReferences: [] };
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

  const fixturesByOp = {};
  const counters = {};
  let pendingBindError = null;

  for (const f of ldapFixtures) {
    const op = f.operation;
    if (!fixturesByOp[op]) fixturesByOp[op] = [];
    fixturesByOp[op].push(f);
    counters[op] = 0;
  }

  if (fixturesByOp['bind']) {
    for (const f of fixturesByOp['bind']) {
      if (f.result === 'error') {
        pendingBindError = { code: f.code || 49, message: f.message || 'Bind failed' };
        break;
      }
    }
    delete fixturesByOp['bind'];
  }
  delete fixturesByOp['unbind'];

  return function handleLdapWithFixtures(params) {
    const { operation } = params;
    if (!operation) {
      return { error: { code: -32602, message: 'Missing required parameter: operation' } };
    }

    if (pendingBindError) {
      const err = pendingBindError;
      pendingBindError = null;
      return { error: err };
    }

    const list = fixturesByOp[operation];
    if (!list || list.length === 0) {
      return { error: { code: -32001, message: `No LDAP fixture defined for operation: ${operation}` } };
    }

    const idx = counters[operation];
    const fixture = idx < list.length ? list[idx] : list[list.length - 1];
    if (idx < list.length) counters[operation]++;

    if (fixture.result === 'error') {
      return {
        error: {
          code: fixture.code || -32603,
          message: fixture.message || 'LDAP operation failed',
        },
      };
    }

    switch (operation) {
      case 'search': {
        const rawEntries = fixture.searchEntries || fixture.entries || [];
        const entries = rawEntries.map((entry) =>
          entry.attributes ? { dn: entry.dn, ...entry.attributes } : entry,
        );
        return { searchEntries: entries, searchReferences: fixture.searchReferences || [] };
      }
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
