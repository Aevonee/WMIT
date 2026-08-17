'use strict';

class WmitError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WmitError';
    this.code = code;
    this.details = details || {};
  }
}

class ValidationError extends WmitError {
  constructor(message, errors) {
    super('VALIDATION_ERROR', message, { errors: errors || [] });
    this.name = 'ValidationError';
  }
}

class NotFoundError extends WmitError {
  constructor(entityType, id) {
    super('NOT_FOUND', entityType + ' ' + id + ' was not found.', { entityType, id });
    this.name = 'NotFoundError';
  }
}

class DuplicateError extends WmitError {
  constructor(entityType, id) {
    super('DUPLICATE_ID', entityType + ' ' + id + ' already exists.', { entityType, id });
    this.name = 'DuplicateError';
  }
}

class ConfigurationError extends WmitError {
  constructor(message, details) {
    super('CONFIGURATION_ERROR', message, details);
    this.name = 'ConfigurationError';
  }
}

function errorResult(error) {
  if (error instanceof WmitError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    };
  }

  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: 'The operation could not be completed safely.',
      details: {}
    }
  };
}

module.exports = {
  WmitError,
  ValidationError,
  NotFoundError,
  DuplicateError,
  ConfigurationError,
  errorResult
};
