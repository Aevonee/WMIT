'use strict';

const { getEntitySchema } = require('../models/schema');
const { IdGenerator } = require('../ids/id-generator');
const { InMemoryRepository } = require('../repositories/memory-repository');
const { InMemoryAuditLog } = require('../logging/audit-log');
const { makeEntityService } = require('./entity-service');
const { getDefaultConfig } = require('../config/config');

function createLocalRuntime(options) {
  const opts = options || {};
  const config = opts.config || getDefaultConfig();
  const clock = opts.clock || (() => new Date());
  const idGenerator = opts.idGenerator || new IdGenerator({ clock });
  const auditLog = opts.auditLog || new InMemoryAuditLog({ clock, idGenerator: new IdGenerator({ clock }) });
  const repositories = {};
  const services = {};

  Object.keys(require('../models/schema').SCHEMA).forEach((entityType) => {
    const schema = getEntitySchema(entityType);
    repositories[entityType] = opts.repositories && opts.repositories[entityType]
      ? opts.repositories[entityType]
      : new InMemoryRepository(entityType, { idField: schema.idField });
  });

  Object.keys(repositories).forEach((entityType) => {
    services[entityType] = makeEntityService({
      entityType,
      schema: getEntitySchema(entityType),
      repository: repositories[entityType],
      repositories,
      config,
      idGenerator,
      auditLog,
      clock
    });
  });

  return { config, clock, idGenerator, auditLog, repositories, services };
}

function createApi(runtime) {
  const services = runtime.services;
  return {
    createClient: (input, context) => services.Client.create(input, context),
    getClient: (id, context) => services.Client.get(id, context),
    updateClient: (id, changes, context) => services.Client.update(id, changes, context),
    createSupplier: (input, context) => services.Supplier.create(input, context),
    getSupplier: (id, context) => services.Supplier.get(id, context),
    updateSupplier: (id, changes, context) => services.Supplier.update(id, changes, context),
    createLead: (input, context) => services.Lead.create(input, context),
    getLead: (id, context) => services.Lead.get(id, context),
    updateLead: (id, changes, context) => services.Lead.update(id, changes, context)
  };
}

module.exports = { createLocalRuntime, createApi };
