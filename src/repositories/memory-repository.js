'use strict';

const { DuplicateError, NotFoundError, WmitError } = require('../core/errors');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class InMemoryRepository {
  constructor(entityType, options) {
    const opts = options || {};
    this.entityType = entityType;
    this.idField = opts.idField || (entityType.toLowerCase() + '_id');
    this.records = new Map();
  }

  insert(record) {
    const id = record[this.idField];
    if (this.records.has(id)) throw new DuplicateError(this.entityType, id);
    this.records.set(id, clone(record));
    return clone(record);
  }

  get(id) {
    return this.records.has(id) ? clone(this.records.get(id)) : null;
  }

  require(id) {
    const record = this.get(id);
    if (!record) throw new NotFoundError(this.entityType, id);
    return record;
  }

  update(id, changes) {
    const current = this.require(id);
    if (changes[this.idField] && changes[this.idField] !== id) {
      throw new WmitError('IMMUTABLE_ID', this.entityType + ' IDs cannot be changed.', { idField: this.idField });
    }
    const updated = Object.assign({}, current, changes, { [this.idField]: id });
    this.records.set(id, clone(updated));
    return clone(updated);
  }

  delete(id) {
    const current = this.require(id);
    this.records.delete(id);
    return clone(current);
  }

  exists(id) {
    return this.records.has(id);
  }

  list() {
    return Array.from(this.records.values()).map(clone);
  }

  clear() {
    this.records.clear();
  }
}

class InMemoryDriveRepository {
  constructor() {
    this.files = new Map();
  }

  create(file) {
    if (!file || !file.file_id) throw new WmitError('INVALID_FILE', 'A test file requires file_id metadata.');
    if (this.files.has(file.file_id)) throw new DuplicateError('DocumentFile', file.file_id);
    this.files.set(file.file_id, clone(file));
    return clone(file);
  }

  get(fileId) {
    return this.files.has(fileId) ? clone(this.files.get(fileId)) : null;
  }
}

module.exports = { InMemoryRepository, InMemoryDriveRepository };
