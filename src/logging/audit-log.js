'use strict';

const { IdGenerator } = require('../ids/id-generator');

class InMemoryAuditLog {
  constructor(options) {
    const opts = options || {};
    this.events = [];
    this.idGenerator = opts.idGenerator || new IdGenerator({ clock: opts.clock });
    this.clock = opts.clock || (() => new Date());
  }

  record(event) {
    const input = event || {};
    const auditEvent = {
      audit_id: input.audit_id || this.idGenerator.next('AUDIT', { yearBased: true }),
      timestamp: input.timestamp || this.clock().toISOString(),
      actor: input.actor || 'SYSTEM',
      agent: input.agent || null,
      action: input.action || 'SYSTEM',
      entity_type: input.entity_type || null,
      entity_id: input.entity_id || null,
      result: input.result || 'SUCCESS',
      details: input.details || {},
      correlation_id: input.correlation_id || null
    };
    this.events.push(JSON.parse(JSON.stringify(auditEvent)));
    return JSON.parse(JSON.stringify(auditEvent));
  }

  list() {
    return JSON.parse(JSON.stringify(this.events));
  }
}

module.exports = { InMemoryAuditLog };
