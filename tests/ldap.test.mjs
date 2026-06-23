import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLdapHandler } from '../src/host/handlers/ldap.mjs';

describe('ldap handler (fixture-based)', () => {
  it('returns error when operation is missing', () => {
    const handler = createLdapHandler([]);
    const result = handler({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: operation' },
    });
  });

  it('returns empty search results when no fixtures provided', () => {
    const handler = createLdapHandler([]);
    const result = handler({ operation: 'search' });
    assert.deepEqual(result, { searchEntries: [], searchReferences: [] });
  });

  it('returns success for modify with no fixtures', () => {
    const handler = createLdapHandler([]);
    const result = handler({ operation: 'modify' });
    assert.deepEqual(result, { success: true });
  });

  it('returns error for unknown operation with no fixtures', () => {
    const handler = createLdapHandler([]);
    const result = handler({ operation: 'unknown_op' });
    assert.deepEqual(result, {
      error: { code: -32601, message: 'Unknown LDAP operation: unknown_op' },
    });
  });

  it('serves search fixtures in order', () => {
    const handler = createLdapHandler([
      { operation: 'search', searchEntries: [{ dn: 'cn=user1', cn: 'user1' }] },
      { operation: 'search', searchEntries: [{ dn: 'cn=user2', cn: 'user2' }] },
    ]);

    const r1 = handler({ operation: 'search' });
    assert.deepEqual(r1.searchEntries, [{ dn: 'cn=user1', cn: 'user1' }]);

    const r2 = handler({ operation: 'search' });
    assert.deepEqual(r2.searchEntries, [{ dn: 'cn=user2', cn: 'user2' }]);

    // Beyond fixture list, repeats the last one
    const r3 = handler({ operation: 'search' });
    assert.deepEqual(r3.searchEntries, [{ dn: 'cn=user2', cn: 'user2' }]);
  });

  it('handles bind error fixture', () => {
    const handler = createLdapHandler([
      { operation: 'bind', result: 'error', code: 49, message: 'INVALID_CREDENTIALS' },
      { operation: 'search', searchEntries: [{ dn: 'cn=user1' }] },
    ]);

    // First call returns bind error regardless of operation
    const r1 = handler({ operation: 'search' });
    assert.deepEqual(r1, {
      error: { code: 49, message: 'INVALID_CREDENTIALS' },
    });

    // Subsequent calls work normally
    const r2 = handler({ operation: 'search' });
    assert.deepEqual(r2.searchEntries, [{ dn: 'cn=user1' }]);
  });

  it('handles operation error fixture', () => {
    const handler = createLdapHandler([
      { operation: 'search', result: 'error', code: -32603, message: 'LDAP operation failed' },
    ]);

    const result = handler({ operation: 'search' });
    assert.deepEqual(result, {
      error: { code: -32603, message: 'LDAP operation failed' },
    });
  });

  it('returns error when no fixture matches operation', () => {
    const handler = createLdapHandler([
      { operation: 'search', searchEntries: [] },
    ]);

    const result = handler({ operation: 'modify' });
    assert.deepEqual(result, {
      error: { code: -32001, message: 'No LDAP fixture defined for operation: modify' },
    });
  });

  it('normalizes entries with attributes field', () => {
    const handler = createLdapHandler([
      {
        operation: 'search',
        searchEntries: [{ dn: 'cn=user1', attributes: { cn: 'user1', mail: 'u@test.com' } }],
      },
    ]);

    const result = handler({ operation: 'search' });
    assert.deepEqual(result.searchEntries, [{ dn: 'cn=user1', cn: 'user1', mail: 'u@test.com' }]);
  });

  it('supports all non-search operations', () => {
    for (const op of ['modify', 'add', 'delete', 'modifyDN', 'compare']) {
      const handler = createLdapHandler([{ operation: op }]);
      const result = handler({ operation: op });
      assert.deepEqual(result, { success: true });
    }
  });
});
