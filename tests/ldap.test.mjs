import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLdapHandler } from '../src/handlers/ldap.mjs';

function createMockClient() {
  return {
    bind: mock.fn(async () => {}),
    unbind: mock.fn(async () => {}),
    search: mock.fn(async () => ({
      searchEntries: [{ dn: 'cn=user,dc=example,dc=com', cn: 'user' }],
      searchReferences: [],
    })),
    modify: mock.fn(async () => {}),
    add: mock.fn(async () => {}),
    del: mock.fn(async () => {}),
  };
}

let latestClient;

function MockClientImpl(options) {
  const client = createMockClient();
  client.options = options;
  latestClient = client;
  return client;
}

describe('ldap handler (passthrough)', () => {
  let handleLdap;

  beforeEach(() => {
    latestClient = null;
    handleLdap = createLdapHandler({ ClientImpl: MockClientImpl });
  });

  it('returns error when operation is missing', async () => {
    const result = await handleLdap({});
    assert.deepEqual(result, {
      error: { code: -32602, message: 'Missing required parameter: operation' },
    });
  });

  it('returns error for unknown operation', async () => {
    const result = await handleLdap({ operation: 'unknown_op', url: 'ldap://localhost' });
    assert.deepEqual(result, {
      error: { code: -32601, message: 'Unknown LDAP operation: unknown_op' },
    });
  });

  it('returns error when url is missing on bind', async () => {
    const result = await handleLdap({ operation: 'bind', dn: 'cn=admin', password: 'secret' });
    assert.equal(result.error.message, 'Missing required parameter: url');
  });

  it('binds to LDAP server and creates client', async () => {
    const result = await handleLdap({
      operation: 'bind',
      url: 'ldaps://ad.example.com:636',
      tlsOptions: { rejectUnauthorized: false },
      timeout: 5000,
      connectTimeout: 3000,
      dn: 'cn=admin,dc=example,dc=com',
      password: 'secret',
    });

    assert.deepEqual(result, { success: true });
    assert.deepEqual(latestClient.options, {
      url: 'ldaps://ad.example.com:636',
      tlsOptions: { rejectUnauthorized: false },
      timeout: 5000,
      connectTimeout: 3000,
    });
    assert.equal(latestClient.bind.mock.callCount(), 1);
    assert.deepEqual(latestClient.bind.mock.calls[0].arguments, ['cn=admin,dc=example,dc=com', 'secret']);
  });

  it('searches after bind', async () => {
    await handleLdap({
      operation: 'bind',
      url: 'ldaps://search-test.example.com:636',
      dn: 'cn=admin',
      password: 'secret',
    });

    const result = await handleLdap({
      operation: 'search',
      url: 'ldaps://search-test.example.com:636',
      baseDN: 'dc=example,dc=com',
      filter: '(uid=jdoe)',
      scope: 'sub',
    });

    assert.deepEqual(result, {
      searchEntries: [{ dn: 'cn=user,dc=example,dc=com', cn: 'user' }],
      searchReferences: [],
    });
    assert.equal(latestClient.search.mock.callCount(), 1);
    const searchArgs = latestClient.search.mock.calls[0].arguments;
    assert.equal(searchArgs[0], 'dc=example,dc=com');
    assert.equal(searchArgs[1].filter, '(uid=jdoe)');
    assert.equal(searchArgs[1].scope, 'sub');
  });

  it('returns error when searching without prior bind', async () => {
    const result = await handleLdap({
      operation: 'search',
      url: 'ldaps://no-bind.example.com:636',
      baseDN: 'dc=example,dc=com',
    });

    assert.deepEqual(result, {
      error: { code: -32600, message: 'No active connection. Call bind first.' },
    });
  });

  it('modifies with changes', async () => {
    await handleLdap({
      operation: 'bind',
      url: 'ldaps://modify-test.example.com:636',
      dn: 'cn=admin',
      password: 'secret',
    });

    const result = await handleLdap({
      operation: 'modify',
      url: 'ldaps://modify-test.example.com:636',
      dn: 'cn=user,dc=example,dc=com',
      changes: [{
        operation: 'add',
        modification: { type: 'member', values: ['cn=new,dc=example,dc=com'] },
      }],
    });

    assert.deepEqual(result, { success: true });
    assert.equal(latestClient.modify.mock.callCount(), 1);
    const modifyArgs = latestClient.modify.mock.calls[0].arguments;
    assert.equal(modifyArgs[0], 'cn=user,dc=example,dc=com');
    assert.equal(modifyArgs[1].length, 1);
  });

  it('adds an entry', async () => {
    await handleLdap({
      operation: 'bind',
      url: 'ldaps://add-test.example.com:636',
      dn: 'cn=admin',
      password: 'secret',
    });

    const result = await handleLdap({
      operation: 'add',
      url: 'ldaps://add-test.example.com:636',
      dn: 'cn=newuser,dc=example,dc=com',
      attributes: { cn: 'newuser', sn: 'User' },
    });

    assert.deepEqual(result, { success: true });
    assert.equal(latestClient.add.mock.callCount(), 1);
    assert.deepEqual(latestClient.add.mock.calls[0].arguments, [
      'cn=newuser,dc=example,dc=com',
      { cn: 'newuser', sn: 'User' },
    ]);
  });

  it('deletes an entry', async () => {
    await handleLdap({
      operation: 'bind',
      url: 'ldaps://del-test.example.com:636',
      dn: 'cn=admin',
      password: 'secret',
    });

    const result = await handleLdap({
      operation: 'delete',
      url: 'ldaps://del-test.example.com:636',
      dn: 'cn=olduser,dc=example,dc=com',
    });

    assert.deepEqual(result, { success: true });
    assert.equal(latestClient.del.mock.callCount(), 1);
    assert.deepEqual(latestClient.del.mock.calls[0].arguments, ['cn=olduser,dc=example,dc=com']);
  });

  it('unbinds and removes client from map', async () => {
    await handleLdap({
      operation: 'bind',
      url: 'ldaps://unbind-test.example.com:636',
      dn: 'cn=admin',
      password: 'secret',
    });

    const result = await handleLdap({
      operation: 'unbind',
      url: 'ldaps://unbind-test.example.com:636',
    });

    assert.deepEqual(result, { success: true });
    assert.equal(latestClient.unbind.mock.callCount(), 1);

    const searchResult = await handleLdap({
      operation: 'search',
      url: 'ldaps://unbind-test.example.com:636',
      baseDN: 'dc=example,dc=com',
    });
    assert.equal(searchResult.error.message, 'No active connection. Call bind first.');
  });

  it('returns error details when ldap operation throws', async () => {
    function FailingClient() {
      return {
        bind: async () => {
          const err = new Error('INVALID_CREDENTIALS');
          err.code = 49;
          throw err;
        },
      };
    }

    const handler = createLdapHandler({ ClientImpl: FailingClient });

    const result = await handler({
      operation: 'bind',
      url: 'ldaps://error-test.example.com:636',
      dn: 'cn=admin',
      password: 'wrong',
    });

    assert.deepEqual(result, {
      error: { code: 49, message: 'INVALID_CREDENTIALS' },
    });
  });
});
