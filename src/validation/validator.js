'use strict';

const { ValidationError } = require('../core/errors');

const ID_PATTERN = /^[A-Z][A-Z0-9_]*-(?:(?:[0-9]{4}|TEST)-)?[0-9]{6}$/;
const EMAIL_PATTERN = /^[^ @]+@[^ @]+[.][^ @]+$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATETIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;

function isBlank(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function add(errors, field, message, value) {
  errors.push({ field, message, value: value === undefined ? null : value });
}

function validateId(value, field) {
  const errors = [];
  if (isBlank(value) || typeof value !== 'string' || !ID_PATTERN.test(value)) {
    add(errors, field, 'Use an ID such as CLIENT-000001 or BOOKING-2026-000001.', value);
  }
  return errors;
}

function validateDate(value, field, dateTime) {
  const errors = [];
  const pattern = dateTime ? DATETIME_PATTERN : DATE_PATTERN;
  if (isBlank(value) || typeof value !== 'string' || !pattern.test(value)) {
    add(errors, field, dateTime ? 'Use an ISO date-time such as 2026-08-12T09:00:00+08:00.' : 'Use an ISO date such as 2026-08-12.', value);
    return errors;
  }
  const parsed = dateTime ? new Date(value) : new Date(value + 'T00:00:00Z');
  const parts = value.slice(0, 10).split('-').map(Number);
  const dateOnly = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const timeParts = dateTime ? value.slice(11, 19).split(':').map(Number) : [0, 0, 0];
  const validCalendarDate = !Number.isNaN(parsed.getTime())
    && dateOnly.getUTCFullYear() === parts[0]
    && dateOnly.getUTCMonth() + 1 === parts[1]
    && dateOnly.getUTCDate() === parts[2]
    && timeParts[0] >= 0 && timeParts[0] <= 23
    && timeParts[1] >= 0 && timeParts[1] <= 59
    && timeParts[2] >= 0 && timeParts[2] <= 59;
  if (!validCalendarDate) {
    add(errors, field, 'The date is not a real calendar date.', value);
  }
  return errors;
}

function validateEmail(value, field) {
  const errors = [];
  if (!isBlank(value) && (typeof value !== 'string' || !EMAIL_PATTERN.test(value))) {
    add(errors, field, 'Enter a valid email address.', value);
  }
  return errors;
}

function validateAmount(value, field, options) {
  const errors = [];
  const opts = options || {};
  if (isBlank(value) || typeof value !== 'number' || !Number.isFinite(value)) {
    add(errors, field, 'Enter a numeric amount.', value);
  } else if (!opts.allowNegative && value < 0) {
    add(errors, field, 'Amount cannot be negative.', value);
  } else if (opts.max !== undefined && value > opts.max) {
    add(errors, field, 'Amount is above the allowed maximum.', value);
  }
  return errors;
}

function validateRequired(record, schema) {
  const errors = [];
  Object.keys(schema.fields).forEach((field) => {
    if (schema.fields[field].required && isBlank(record[field])) {
      add(errors, field, 'This field is required.', record[field]);
    }
  });
  return errors;
}

function validateUnknownFields(record, schema) {
  const errors = [];
  const knownFields = new Set(Object.keys(schema.fields));
  Object.keys(record).forEach((field) => {
    if (!knownFields.has(field)) {
      add(errors, field, 'This field is not part of the approved schema.', record[field]);
    }
  });
  return errors;
}

function validateFieldTypes(record, schema) {
  const errors = [];
  Object.keys(schema.fields).forEach((field) => {
    const definition = schema.fields[field];
    const value = record[field];
    if (isBlank(value)) return;
    if (definition.type === 'id') errors.push(...validateId(value, field));
    if (definition.type === 'email') errors.push(...validateEmail(value, field));
    if (definition.type === 'date') errors.push(...validateDate(value, field, false));
    if (definition.type === 'datetime') errors.push(...validateDate(value, field, true));
    if (definition.type === 'amount') errors.push(...validateAmount(value, field));
    if (definition.type === 'percentage') errors.push(...validateAmount(value, field, { max: 100 }));
    if (definition.type === 'string' && typeof value !== 'string') add(errors, field, 'Enter text for this field.', value);
    if (definition.type === 'enum' && typeof value !== 'string') add(errors, field, 'Choose a text value for this field.', value);
    if (definition.type === 'integer' && (!Number.isInteger(value) || value < 0)) add(errors, field, 'Enter a whole number of zero or more.', value);
    if (definition.type === 'currency' && (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value))) add(errors, field, 'Use a three-letter currency code such as PHP.', value);
    if (definition.type === 'rate' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) add(errors, field, 'Enter a positive conversion rate.', value);
    if (definition.type === 'boolean' && typeof value !== 'boolean') add(errors, field, 'Use TRUE or FALSE.', value);
  });
  return errors;
}

function validateEnums(record, schema, config) {
  const errors = [];
  Object.keys(schema.fields).forEach((field) => {
    const definition = schema.fields[field];
    if (isBlank(record[field])) return;
    let values = definition.allowed || [];
    if (field === schema.statusField) {
      values = (config && config.allowedStatuses && config.allowedStatuses[schema.tableName.replace(/s$/, '')]) || values;
    }
    if (values.length && !values.includes(record[field])) {
      add(errors, field, 'Choose one of: ' + values.join(', ') + '.', record[field]);
    }
  });
  return errors;
}

function validateDateOrdering(record) {
  const errors = [];
  [
    ['travel_start', 'travel_end'],
    ['service_start', 'service_end'],
    ['quotation_date', 'valid_until'],
    ['invoice_date', 'due_date'],
    ['validity_start', 'validity_end'],
    ['start_date', 'end_date']
  ].forEach(([startField, endField]) => {
    if (!isBlank(record[startField]) && !isBlank(record[endField]) && record[endField] < record[startField]) {
      add(errors, endField, endField + ' cannot be earlier than ' + startField + '.', record[endField]);
    }
  });
  return errors;
}

function validateRecord(record, schema, config) {
  const errors = [
    ...validateUnknownFields(record, schema),
    ...validateRequired(record, schema),
    ...validateFieldTypes(record, schema),
    ...validateEnums(record, schema, config),
    ...validateDateOrdering(record)
  ];
  if (errors.length) {
    throw new ValidationError('Please correct the highlighted fields before saving.', errors);
  }
  return true;
}

function validateReferences(record, schema, repositories, entityType) {
  const errors = [];
  Object.keys(schema.fields).forEach((field) => {
    const definition = schema.fields[field];
    if (!definition.references || isBlank(record[field])) return;
    const repository = repositories[definition.references];
    if (!repository || !repository.exists(record[field])) {
      const relationship = definition.references;
      add(errors, field, record[schema.idField] + ' refers to ' + record[field] + ', but that ' + relationship.toLowerCase() + ' does not exist.', record[field]);
    }
  });
  (schema.polymorphicReferences || []).forEach((relationship) => {
    const type = record[relationship.typeField];
    const id = record[relationship.idField];
    if (isBlank(type) && isBlank(id)) return;
    if (isBlank(type) || isBlank(id)) {
      add(errors, relationship.idField, 'Both the related entity type and related entity ID are required together.', id || type);
      return;
    }
    if (relationship.allowedTypes && !relationship.allowedTypes.includes(type)) {
      add(errors, relationship.typeField, 'Choose a supported related entity type.', type);
      return;
    }
    const repository = repositories[type];
    if (!repository || !repository.exists(id)) {
      add(errors, relationship.idField, record[schema.idField] + ' refers to ' + type + ' ' + id + ', but that record does not exist.', id);
    }
  });
  if (entityType === 'SupplierBookingItem') {
    const supplierBooking = repositories.SupplierBooking && repositories.SupplierBooking.get(record.supplier_booking_id);
    const bookingItem = repositories.BookingItem && repositories.BookingItem.get(record.booking_item_id);
    if (supplierBooking && bookingItem && supplierBooking.booking_id && supplierBooking.booking_id !== bookingItem.booking_id) {
      add(errors, 'booking_item_id', 'This supplier booking belongs to ' + supplierBooking.booking_id + ', but the booking item belongs to ' + bookingItem.booking_id + '.', record.booking_item_id);
    }
  }
  if (errors.length) {
    throw new ValidationError('Some linked records could not be found.', errors);
  }
  return true;
}

function validateStateTransition(entityType, fromStatus, toStatus, transitions) {
  if (!fromStatus || fromStatus === toStatus) return true;
  const allowed = transitions[entityType] && transitions[entityType][fromStatus];
  if (allowed && !allowed.includes(toStatus)) {
    throw new ValidationError('This status change is not allowed.', [{
      field: 'status',
      message: entityType + ' cannot move from ' + fromStatus + ' to ' + toStatus + '.',
      value: toStatus
    }]);
  }
  return true;
}

module.exports = {
  ID_PATTERN,
  isBlank,
  validateId,
  validateDate,
  validateEmail,
  validateAmount,
  validateRequired,
  validateUnknownFields,
  validateFieldTypes,
  validateEnums,
  validateDateOrdering,
  validateRecord,
  validateReferences,
  validateStateTransition
};
