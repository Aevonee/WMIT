'use strict';

const {
  WmitError,
  errorResult
} = require('../core/errors');
const {
  validateRecord,
  validateReferences,
  validateStateTransition,
  isBlank
} = require('../validation/validator');
const { TRANSITIONS } = require('../core/lifecycle');

const DEFAULT_STATUS = {
  Client: 'Active',
  Contact: 'Active',
  Traveler: 'Active',
  Lead: 'New',
  Quotation: 'Draft',
  Booking: 'Draft',
  BookingItem: 'Draft',
  Departure: 'Draft',
  Supplier: 'Active',
  Invoice: 'Draft',
  Payment: 'Pending Verification',
  Document: 'Received',
  SupplierTariff: 'Draft',
  SupplierBooking: 'Draft',
  Task: 'Open'
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeEntityService(options) {
  const {
    entityType,
    schema,
    repository,
    repositories,
    config,
    idGenerator,
    auditLog,
    clock
  } = options;
  const now = clock || (() => new Date());

  function contextOf(context) {
    const input = context || {};
    return {
      actor: input.actor || 'LOCAL_TEST',
      agent: input.agent || null,
      correlationId: input.correlationId || null
    };
  }

  function validateEntityId(id) {
    if (!id.startsWith(schema.prefix + '-')) {
      throw new WmitError('INVALID_ENTITY_ID', entityType + ' IDs must start with ' + schema.prefix + '-.', { id });
    }
    if (schema.yearBased && !new RegExp('^' + schema.prefix + '-(?:[0-9]{4}|TEST)-[0-9]{6}$').test(id)) {
      throw new WmitError('INVALID_ENTITY_ID', entityType + ' IDs must look like ' + schema.prefix + '-2026-000001.', { id });
    }
    if (!schema.yearBased && !new RegExp('^' + schema.prefix + '-(?:TEST-)?[0-9]{6}$').test(id)) {
      throw new WmitError('INVALID_ENTITY_ID', entityType + ' IDs must look like ' + schema.prefix + '-000001.', { id });
    }
  }

  function checkUnique(record, ignoreId) {
    if (!schema.uniqueFields) return;
    repository.list().forEach((existing) => {
      if (existing[schema.idField] === ignoreId || existing[schema.idField] === record[schema.idField]) return;
      schema.uniqueFields.forEach((fields) => {
        const complete = fields.every((field) => !isBlank(record[field]) && !isBlank(existing[field]));
        if (complete && fields.every((field) => String(existing[field]).trim().toLowerCase() === String(record[field]).trim().toLowerCase())) {
          throw new WmitError('DUPLICATE_RECORD', entityType + ' duplicates an existing record on its unique relationship fields.', {
            entityType,
            fields
          });
        }
      });
    });
  }

  function audit(action, record, context, result, details) {
    return auditLog.record({
      actor: context.actor,
      agent: context.agent,
      action,
      entity_type: entityType,
      entity_id: record && record[schema.idField],
      result,
      details: details || {},
      correlation_id: context.correlationId
    });
  }

  function fail(error, context, action, input) {
    audit(action || 'ERROR', input || {}, context, 'ERROR', { code: error.code || 'UNEXPECTED_ERROR', message: error.message });
    return errorResult(error);
  }

  function create(input, context) {
    const ctx = contextOf(context);
    try {
      const source = Object.assign({}, input || {});
      const suppliedId = Boolean(source[schema.idField]);
      const id = source[schema.idField] || idGenerator.next(schema.prefix, { yearBased: schema.yearBased });
      validateEntityId(id);
      if (suppliedId) idGenerator.reserve(schema.prefix, id, { yearBased: schema.yearBased });
      const timestamp = now().toISOString();
      const record = Object.assign({}, source, {
        [schema.idField]: id,
        created_at: source.created_at || timestamp,
        created_by: source.created_by || ctx.actor,
        updated_at: timestamp,
        updated_by: ctx.actor,
        record_version: 1
      });
      if (schema.statusField) {
        record[schema.statusField] = source[schema.statusField] || DEFAULT_STATUS[entityType];
      }
      validateRecord(record, schema, config);
      validateReferences(record, schema, repositories, entityType);
      checkUnique(record);
      const saved = repository.insert(record);
      audit('CREATE', saved, ctx, 'SUCCESS');
      return { ok: true, data: saved, meta: { action: 'CREATE' } };
    } catch (error) {
      return fail(error, ctx, 'CREATE', input);
    }
  }

  function get(id, context) {
    const ctx = contextOf(context);
    try {
      validateEntityId(id);
      const record = repository.get(id);
      if (!record) {
        throw new WmitError('NOT_FOUND', entityType + ' ' + id + ' was not found.', { entityType, id });
      }
      audit('READ', record, ctx, 'SUCCESS');
      return { ok: true, data: record, meta: { action: 'READ' } };
    } catch (error) {
      return fail(error, ctx, 'READ', { [schema.idField]: id });
    }
  }

  function update(id, changes, context) {
    const ctx = contextOf(context);
    try {
      validateEntityId(id);
      const current = repository.get(id);
      if (!current) {
        throw new WmitError('NOT_FOUND', entityType + ' ' + id + ' was not found.', { entityType, id });
      }
      if (changes && changes[schema.idField] && changes[schema.idField] !== id) {
        throw new WmitError('IMMUTABLE_ID', entityType + ' IDs cannot be changed.', { id });
      }
      const merged = Object.assign({}, current, changes || {}, {
        [schema.idField]: id,
        updated_at: now().toISOString(),
        updated_by: ctx.actor,
        record_version: current.record_version + 1
      });
      validateStateTransition(entityType, current[schema.statusField], merged[schema.statusField], TRANSITIONS);
      validateRecord(merged, schema, config);
      validateReferences(merged, schema, repositories, entityType);
      checkUnique(merged, id);
      const saved = repository.update(id, merged);
      audit('UPDATE', saved, ctx, 'SUCCESS', { changedFields: Object.keys(changes || {}) });
      return { ok: true, data: saved, meta: { action: 'UPDATE' } };
    } catch (error) {
      return fail(error, ctx, 'UPDATE', Object.assign({}, changes || {}, { [schema.idField]: id }));
    }
  }

  function remove(id, context) {
    const ctx = contextOf(context);
    try {
      validateEntityId(id);
      const current = repository.get(id);
      if (!current) throw new WmitError('NOT_FOUND', entityType + ' ' + id + ' was not found.', { entityType, id });
      const saved = repository.delete(id);
      audit('DELETE', saved, ctx, 'SUCCESS');
      return { ok: true, data: saved, meta: { action: 'DELETE' } };
    } catch (error) {
      return fail(error, ctx, 'DELETE', { [schema.idField]: id });
    }
  }

  return { create, get, update, remove };
}

module.exports = { makeEntityService, DEFAULT_STATUS };
