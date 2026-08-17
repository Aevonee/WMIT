'use strict';

// Minimal in-process scheduler for hosted-server background jobs.
//
// Jobs run either at a fixed interval or once per day at a wall-clock time in
// the configured timezone (default Asia/Manila). Every run is recorded through
// the onRun hook so jobs can checkpoint their last success and operators can
// see job history in system_job_runs.

class Scheduler {
  constructor(options) {
    const opts = options || {};
    this.timezone = opts.timezone || 'Asia/Manila';
    this.clock = opts.clock || (() => new Date());
    this.onRun = opts.onRun || null;
    this.jobs = new Map();
    this.timers = new Map();
    this.running = false;
  }

  register(name, spec, fn) {
    if (!spec || (!spec.intervalMs && !spec.daily)) throw new Error('Job ' + name + ' needs intervalMs or a daily time.');
    this.jobs.set(name, { name, spec, fn });
    if (this.running) this.schedule(name);
  }

  wallClockInZone(date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type).value;
    return { year: get('year'), month: get('month'), day: get('day'), hour: Number(get('hour')) % 24, minute: Number(get('minute')), second: Number(get('second')) };
  }

  // Converts a wall-clock time in this.timezone to a UTC timestamp using the
  // standard two-pass offset correction.
  wallToUtc(wall) {
    const iso = wall.year + '-' + wall.month + '-' + wall.day + 'T' + String(wall.hour).padStart(2, '0') + ':' + String(wall.minute).padStart(2, '0') + ':00';
    let guess = Date.parse(iso + 'Z');
    for (let pass = 0; pass < 2; pass += 1) {
      const wallNow = this.wallClockInZone(new Date(guess));
      const corrected = Date.parse(wallNow.year + '-' + wallNow.month + '-' + wallNow.day + 'T' + String(wallNow.hour).padStart(2, '0') + ':' + String(wallNow.minute).padStart(2, '0') + ':00Z');
      const offset = corrected - guess;
      guess = Date.parse(iso + 'Z') - offset;
    }
    return guess;
  }

  nextRunAt(name) {
    const job = this.jobs.get(name);
    if (!job) return null;
    const now = this.clock();
    if (job.spec.intervalMs) {
      return now.getTime() + job.spec.intervalMs;
    }
    const { hour, minute } = job.spec.daily;
    const wall = this.wallClockInZone(now);
    const today = this.wallToUtc({ year: wall.year, month: wall.month, day: wall.day, hour, minute });
    if (today > now.getTime()) return today;
    // Past today's time: aim for the same wall clock tomorrow (retry across
    // DST-style shifts by re-deriving the wall date from now + 24h).
    const next = this.wallClockInZone(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    return this.wallToUtc({ year: next.year, month: next.month, day: next.day, hour, minute });
  }

  schedule(name) {
    const job = this.jobs.get(name);
    if (!job) return;
    const runAt = this.nextRunAt(name);
    const minimumDelay = Math.min(250, job.spec.intervalMs || 250);
    const delay = Math.max(minimumDelay, runAt - this.clock().getTime());
    const timer = setTimeout(() => {
      this.timers.delete(name);
      Promise.resolve()
        .then(() => this.runOnce(name))
        .catch(() => { /* runOnce records its own failures */ })
        .then(() => { if (this.running) this.schedule(name); });
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(name, timer);
  }

  async runOnce(name) {
    const job = this.jobs.get(name);
    if (!job) throw new Error('Unknown scheduled job: ' + name);
    const startedAt = new Date().toISOString();
    try {
      const result = await job.fn({ name, startedAt });
      const finishedAt = new Date().toISOString();
      if (this.onRun) this.onRun(name, { status: 'SUCCESS', startedAt, finishedAt, detail: result || null });
      return { status: 'SUCCESS', detail: result || null };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      if (this.onRun) this.onRun(name, { status: 'FAILURE', startedAt, finishedAt, detail: { error: String(error && error.message || error).slice(0, 500) } });
      return { status: 'FAILURE', detail: { error: String(error && error.message || error).slice(0, 500) } };
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (const name of this.jobs.keys()) this.schedule(name);
  }

  stop() {
    this.running = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  jobNames() { return Array.from(this.jobs.keys()); }
}

module.exports = { Scheduler };
