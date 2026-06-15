import { Client, Change, Attribute } from 'ldapts';

export function createLdapHandler({ ClientImpl = Client } = {}) {
  const clients = new Map();

  function getOrCreateClient(url, tlsOptions, timeout, connectTimeout) {
    if (!url) {
      throw new Error('Missing required parameter: url');
    }

    let client = clients.get(url);
    if (!client) {
      client = new ClientImpl({
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
          const client = getOrCreateClient(url, tlsOptions, timeout, connectTimeout);
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
