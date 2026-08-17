'use strict';

const { WmitError } = require('../core/errors');

class IdGenerator {
  constructor(options) {
    const opts = options || {};
    this.counters = Object.assign({}, opts.counters || {});
    this.clock = opts.clock || (() => new Date());
  }

  next(prefix, options) {
    const opts = options || {};
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) {
      throw new WmitError('INVALID_ID_PREFIX', 'ID prefix must use uppercase letters, numbers, or underscores.', { prefix });
    }

    const yearBased = opts.yearBased === true;
    const year = String(opts.year || this.clock().getUTCFullYear());
    const counterKey = yearBased ? prefix + ':' + year : prefix;
    const nextNumber = (this.counters[counterKey] || 0) + 1;
    this.counters[counterKey] = nextNumber;
    const sequence = String(nextNumber).padStart(6, '0');
    return yearBased ? prefix + '-' + year + '-' + sequence : prefix + '-' + sequence;
  }

  reserve(prefix, id, options) {
    const opts = options || {};
    if (!/^[A-Z][A-Z0-9_]*$/.test(prefix)) {
      throw new WmitError('INVALID_ID_PREFIX', 'ID prefix must use uppercase letters, numbers, or underscores.', { prefix });
    }
    const yearBased = opts.yearBased === true;
    const pattern = yearBased
      ? new RegExp('^' + prefix + '-([0-9]{4})-([0-9]{6})$')
      : new RegExp('^' + prefix + '(?:-TEST)?-([0-9]{6})$');
    const match = String(id || '').match(pattern);
    if (!match) return;
    const counterKey = yearBased ? prefix + ':' + match[1] : prefix;
    const number = Number(yearBased ? match[2] : match[1]);
    this.counters[counterKey] = Math.max(this.counters[counterKey] || 0, number);
  }

  snapshot() {
    return Object.assign({}, this.counters);
  }
}

module.exports = { IdGenerator };
