import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLdap } from '../src/handlers/ldap.mjs';

describe('ldap handler', () => {
  it('handles bind operation', async () => {
    const result = await handleLdap({ operation: 'bind', dn: 'cn=admin', password: 'secret' });
    assert.deepEqual(result, { success: true });
  });

  it('handles unbind operation', async () => {
    const result = await handleLdap({ operation: 'unbind' });
    assert.deepEqual(result, { success: true });
  });

  it('handles search operation', async () => {
    const result = await handleLdap({
      operation: 'search',
      baseDN: 'dc=example,dc=com',
      filter: '(uid=jdoe)',
    });
    assert.deepEqual(result, { searchEntries: [], searchReferences: [] });
  });

  it('handles modify operation', async () => {
    const result = await handleLdap({
      operation: 'modify',
      dn: 'cn=user,dc=example,dc=com',
      changes: [{ operation: 'replace', modification: { type: 'userAccountControl', values: ['514'] } }],
    });
    assert.deepEqual(result, { success: true });
  });

  it('handles add operation', async () => {
    const result = await handleLdap({
      operation: 'add',
      dn: 'cn=newuser,dc=example,dc=com',
      attributes: { cn: 'newuser', sn: 'User' },
    });
    assert.deepEqual(result, { success: true });
  });

  it('handles delete operation', async () => {
    const result = await handleLdap({
      operation: 'delete',
      dn: 'cn=olduser,dc=example,dc=com',
    });
    assert.deepEqual(result, { success: true });
  });

  it('returns error for unknown operation', async () => {
    const result = await handleLdap({ operation: 'unknown_op' });
    assert.deepEqual(result, {
      error: { code: -32601, message: 'Unknown LDAP operation: unknown_op' },
    });
  });
});
