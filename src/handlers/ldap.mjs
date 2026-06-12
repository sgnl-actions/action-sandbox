/**
 * LDAP mock handler.
 * Receives: { operation, ...params }
 * Returns mock responses for bind/unbind/search/modify/add/delete.
 */
export async function handleLdap(params) {
  const { operation, ...rest } = params;

  switch (operation) {
    case 'bind':
      return { success: true };

    case 'unbind':
      return { success: true };

    case 'search':
      return { searchEntries: [], searchReferences: [] };

    case 'modify':
      return { success: true };

    case 'add':
      return { success: true };

    case 'delete':
      return { success: true };

    default:
      return { error: { code: -32601, message: `Unknown LDAP operation: ${operation}` } };
  }
}
