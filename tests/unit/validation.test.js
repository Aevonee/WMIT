'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getDefaultConfig } = require('../../src/config/config');
const { getEntitySchema } = require('../../src/models/schema');
const {
  validateId,
  validateDate,
  validateAmount,
  validateEmail,
  validateRecord,
  validateStateTransition
} = require('../../src/validation/validator');
const { TRANSITIONS } = require('../../src/core/lifecycle');
const { ValidationError } = require('../../src/core/errors');

test('rejects malformed IDs, dates, email addresses, and amounts', () => {
  assert.equal(validateId('not-an-id', 'client_id').length, 1);
  assert.equal(validateDate('2026-02-31', 'travel_start').length, 1);
  assert.equal(validateEmail('not-an-email', 'primary_email').length, 1);
  assert.equal(validateAmount(-1, 'amount').length, 1);
});

test('rejects missing required fields and invalid status values', () => {
  assert.throws(
    () => validateRecord({ client_id: 'CLIENT-TEST-000001', status: 'Unknown' }, getEntitySchema('Client'), getDefaultConfig()),
    (error) => error instanceof ValidationError && error.details.errors.some((item) => item.field === 'legal_name') && error.details.errors.some((item) => item.field === 'status')
  );
});

test('rejects invalid lifecycle transitions', () => {
  assert.throws(
    () => validateStateTransition('Booking', 'Draft', 'Paid', TRANSITIONS),
    ValidationError
  );
});
