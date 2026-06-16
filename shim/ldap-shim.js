// ldap-shim.js — Mock ldapts module for sandboxed actions.

import { rpcCall } from "./transport.js";

class MockAttribute {
  constructor({ type, values }) {
    this.type = type;
    this.values = values || [];
  }
}

class MockChange {
  constructor({ operation, modification }) {
    this.operation = operation;
    this.modification = modification;
  }
}

class MockClient {
  constructor(options = {}) {
    this.url = options.url;
    this.timeout = options.timeout;
    this.connectTimeout = options.connectTimeout;
    this.tlsOptions = options.tlsOptions;
    this.bindDN = null;
    this.bindPassword = null;
  }

  #baseParams() {
    return {
      url: this.url,
      bindDN: this.bindDN,
      bindPassword: this.bindPassword,
    };
  }

  async bind(dn, password) {
    this.bindDN = dn;
    this.bindPassword = password;
  }

  async unbind() {
    this.bindDN = null;
    this.bindPassword = null;
  }

  async search(baseDN, options = {}) {
    return await rpcCall("ldap", { operation: "search", ...this.#baseParams(), baseDN, ...options });
  }

  async modify(dn, changes) {
    const serializedChanges = changes.map(c => ({
      operation: c.operation,
      modification: { type: c.modification.type, values: c.modification.values },
    }));
    return await rpcCall("ldap", { operation: "modify", ...this.#baseParams(), dn, changes: serializedChanges });
  }

  async add(dn, attributes) {
    return await rpcCall("ldap", { operation: "add", ...this.#baseParams(), dn, attributes_entry: attributes });
  }

  async del(dn) {
    return await rpcCall("ldap", { operation: "delete", ...this.#baseParams(), dn });
  }

  async modifyDN(dn, newDN) {
    return await rpcCall("ldap", { operation: "modifyDN", ...this.#baseParams(), dn, newDN });
  }

  async compare(dn, attribute, value) {
    return await rpcCall("ldap", { operation: "compare", ...this.#baseParams(), dn, attribute, value });
  }
}

export const ldaptsModule = {
  Client: MockClient,
  Change: MockChange,
  Attribute: MockAttribute,
  EqualityFilter: class EqualityFilter {
    constructor({ attribute, value }) {
      this.attribute = attribute;
      this.value = value;
    }
    toString() { return `(${this.attribute}=${this.value})`; }
  },
  AndFilter: class AndFilter {
    constructor({ filters }) {
      this.filters = filters || [];
    }
    toString() { return `(&${this.filters.map(f => f.toString()).join('')})`; }
  },
};
