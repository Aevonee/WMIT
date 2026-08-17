'use strict';

// Hosted-server authentication: WMIT username/password accounts, expiring
// sessions, login rate limiting, and role-to-runtime-authority mapping.
//
// This is the Node port of the Apps Script login design (salted, iterated
// SHA-256 hashes; sessions expire; failed sign-ins are rate limited). Actors
// are identified as USER:<username> in the runtime and the audit log.

const crypto = require('node:crypto');
const { WmitError } = require('../core/errors');

const PASSWORD_ITERATIONS = 2500;
const ROLES = ['ADMIN', 'STAFF', 'INTERN'];
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,39}$/;

function hashPassword(password, salt, iterations) {
  let digest = crypto.createHash('sha256').update(String(salt) + ':' + String(password), 'utf8').digest();
  const rounds = Number(iterations) > 0 ? Number(iterations) : PASSWORD_ITERATIONS;
  for (let i = 1; i < rounds; i += 1) digest = crypto.createHash('sha256').update(digest).digest();
  return digest.toString('base64');
}

function passwordMatches(password, account) {
  const iterations = Number(account.iterations) > 0 ? Number(account.iterations) : PASSWORD_ITERATIONS;
  return hashPassword(password, account.salt, iterations) === account.password_hash;
}

class AuthStore {
  constructor(db, options) {
    const opts = options || {};
    this.db = db;
    this.clock = opts.clock || (() => new Date());
    this.sessionTtlMs = opts.sessionTtlMs || 6 * 60 * 60 * 1000;
    this.maxFailures = opts.maxFailures || 5;
    this.failureWindowMs = opts.failureWindowMs || 5 * 60 * 1000;
    this.failures = new Map();
    this.onAccountsChanged = opts.onAccountsChanged || null;
    db.exec('CREATE TABLE IF NOT EXISTS auth_accounts (username TEXT PRIMARY KEY, display_name TEXT, role TEXT, status TEXT, salt TEXT, iterations INTEGER, password_hash TEXT, created_at TEXT, updated_at TEXT)');
    db.exec('CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, username TEXT, role TEXT, created_at TEXT, expires_at TEXT)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)');
    this.selectAccount = db.prepare('SELECT * FROM auth_accounts WHERE username = ?');
    this.listAccountsStatement = db.prepare('SELECT * FROM auth_accounts ORDER BY username ASC');
    this.insertAccount = db.prepare('INSERT INTO auth_accounts (username, display_name, role, status, salt, iterations, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    this.updateAccount = db.prepare('UPDATE auth_accounts SET display_name = ?, role = ?, status = ?, salt = ?, iterations = ?, password_hash = ?, updated_at = ? WHERE username = ?');
    this.insertSession = db.prepare('INSERT INTO auth_sessions (token, username, role, created_at, expires_at) VALUES (?, ?, ?, ?, ?)');
    this.selectSession = db.prepare('SELECT * FROM auth_sessions WHERE token = ?');
    this.deleteSession = db.prepare('DELETE FROM auth_sessions WHERE token = ?');
    this.deleteOtherSessions = db.prepare('DELETE FROM auth_sessions WHERE username = ? AND token != ?');
  }

  now() { return this.clock().toISOString(); }

  authorityFor(role) {
    // Imported lazily to avoid a load-order dependency in tests.
    const { LOCAL_AUTH } = require('../application/phase1');
    if (role === 'ADMIN') return LOCAL_AUTH.LOCAL_MANAGER.concat(LOCAL_AUTH.LOCAL_STAFF);
    if (role === 'STAFF') return LOCAL_AUTH.LOCAL_STAFF.slice();
    return [];
  }

  trustedActors() {
    const map = {};
    this.listAccountsStatement.all().forEach((account) => {
      if (account.status !== 'ACTIVE') return;
      map['USER:' + account.username] = this.authorityFor(account.role);
    });
    return map;
  }

  refreshRuntimeAuthorities() {
    if (typeof this.onAccountsChanged === 'function') this.onAccountsChanged(this.trustedActors());
  }

  activeAdminCount() {
    return this.listAccountsStatement.all().filter((account) => account.role === 'ADMIN' && account.status === 'ACTIVE').length;
  }

  createAccount(input, actor) {
    const value = input || {};
    const username = String(value.username || '').trim().toLowerCase();
    const password = String(value.password || '');
    const role = String(value.role || '').trim().toUpperCase();
    if (!USERNAME_PATTERN.test(username)) throw new WmitError('ACCOUNT_USERNAME_INVALID', 'Username must be 3-40 characters and use only letters, numbers, dot, underscore, or hyphen.');
    if (password.length < 10) throw new WmitError('ACCOUNT_PASSWORD_INVALID', 'Password must be at least 10 characters.');
    if (!ROLES.includes(role)) throw new WmitError('ACCOUNT_ROLE_INVALID', 'Role must be ADMIN, STAFF, or INTERN.');
    if (this.selectAccount.get(username)) throw new WmitError('ACCOUNT_DUPLICATE', 'That username already exists.');
    const salt = crypto.randomUUID();
    const now = this.now();
    this.insertAccount.run(username, String(value.display_name || username).trim(), role, 'ACTIVE', salt, PASSWORD_ITERATIONS, hashPassword(password, salt), now, now);
    this.audit(actor || 'SYSTEM', 'CREATE_ACCOUNT', username, { role });
    this.refreshRuntimeAuthorities();
    return { username, display_name: String(value.display_name || username).trim(), role, status: 'ACTIVE' };
  }

  // Creates the first administrator. The initial password comes from
  // WMIT_ADMIN_INITIAL_PASSWORD or is generated; either way it is returned
  // exactly once to the caller (which writes it to a owner-only file) and is
  // never stored or logged in plaintext.
  bootstrapAdmin(options) {
    const opts = options || {};
    if (this.listAccountsStatement.all().length) return { bootstrapped: false, reason: 'ACCOUNTS_EXIST' };
    const password = opts.password && String(opts.password).length >= 10
      ? String(opts.password)
      : 'WMIT-' + crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + '!';
    const account = this.createAccount({ username: opts.username || 'admin', password, role: 'ADMIN', display_name: 'WMIT Administrator' }, 'SYSTEM_BOOTSTRAP');
    return { bootstrapped: true, username: account.username, temporary_password: password };
  }

  setAccountStatus(username, status, actor, sessionUsername) {
    const account = this.requireAccount(username);
    const next = String(status || '').trim().toUpperCase();
    if (!['ACTIVE', 'DISABLED'].includes(next)) throw new WmitError('ACCOUNT_STATUS_INVALID', 'Account status must be ACTIVE or DISABLED.');
    if (sessionUsername && sessionUsername === account.username && next !== 'ACTIVE') throw new WmitError('ACCOUNT_SELF_DISABLE', 'You cannot disable your own signed-in account.');
    if (next === 'DISABLED' && account.role === 'ADMIN' && account.status === 'ACTIVE' && this.activeAdminCount() <= 1) {
      throw new WmitError('ACCOUNT_LAST_ADMIN', 'At least one active Admin account must remain.');
    }
    this.updateAccount.run(account.display_name, account.role, next, account.salt, account.iterations, account.password_hash, this.now(), account.username);
    this.audit(actor, 'SET_ACCOUNT_STATUS', account.username, { status: next });
    this.refreshRuntimeAuthorities();
    return { username: account.username, status: next };
  }

  updateAccountRole(username, role, actor, sessionUsername) {
    const account = this.requireAccount(username);
    const next = String(role || '').trim().toUpperCase();
    if (!ROLES.includes(next)) throw new WmitError('ACCOUNT_ROLE_INVALID', 'Role must be ADMIN, STAFF, or INTERN.');
    if (sessionUsername && sessionUsername === account.username && next !== 'ADMIN') throw new WmitError('ACCOUNT_SELF_DEMOTE', 'You cannot remove Admin access from your own signed-in account.');
    if (account.role === 'ADMIN' && next !== 'ADMIN' && account.status === 'ACTIVE' && this.activeAdminCount() <= 1) {
      throw new WmitError('ACCOUNT_LAST_ADMIN', 'At least one active Admin account must remain.');
    }
    this.updateAccount.run(account.display_name, next, account.status, account.salt, account.iterations, account.password_hash, this.now(), account.username);
    this.audit(actor, 'UPDATE_ACCOUNT_ROLE', account.username, { role: next });
    this.refreshRuntimeAuthorities();
    return { username: account.username, role: next };
  }

  resetPassword(username, newPassword, actor) {
    const account = this.requireAccount(username);
    if (String(newPassword || '').length < 10) throw new WmitError('ACCOUNT_PASSWORD_INVALID', 'Password must be at least 10 characters.');
    const salt = crypto.randomUUID();
    this.updateAccount.run(account.display_name, account.role, account.status, salt, PASSWORD_ITERATIONS, hashPassword(newPassword, salt), this.now(), account.username);
    this.audit(actor, 'RESET_ACCOUNT_PASSWORD', account.username, {});
    return { username: account.username };
  }

  changeOwnPassword(username, currentPassword, newPassword, currentToken) {
    const account = this.requireAccount(username);
    if (!passwordMatches(currentPassword || '', account)) throw new WmitError('ACCOUNT_PASSWORD_INCORRECT', 'Current password is incorrect.');
    if (String(newPassword || '').length < 10) throw new WmitError('ACCOUNT_PASSWORD_INVALID', 'New password must be at least 10 characters.');
    const salt = crypto.randomUUID();
    this.updateAccount.run(account.display_name, account.role, account.status, salt, PASSWORD_ITERATIONS, hashPassword(newPassword, salt), this.now(), account.username);
    // Revoke every OTHER session of this account; the caller's own session
    // (currentToken) survives so they stay signed in on this device.
    this.deleteOtherSessions.run(account.username, String(currentToken || ''));
    this.audit('USER:' + username, 'CHANGE_OWN_PASSWORD', username, {});
    return { username };
  }

  requireAccount(username) {
    const account = this.selectAccount.get(String(username || '').trim().toLowerCase());
    if (!account) throw new WmitError('ACCOUNT_NOT_FOUND', 'WMIT account was not found.');
    return account;
  }

  login(input) {
    const value = input || {};
    const username = String(value.username || '').trim().toLowerCase();
    const password = String(value.password || '');
    if (!username || !password) throw new WmitError('LOGIN_INVALID', 'Username and password are required.');
    const key = username;
    const entry = this.failures.get(key);
    const nowMs = this.clock().getTime();
    if (entry && entry.count >= this.maxFailures && nowMs < entry.until) {
      throw new WmitError('LOGIN_RATE_LIMITED', 'Too many failed sign-in attempts. Try again in five minutes.');
    }
    const account = this.selectAccount.get(username);
    if (!account || account.status !== 'ACTIVE' || !passwordMatches(password, account)) {
      const next = entry && nowMs < entry.until ? { count: entry.count + 1, until: entry.until || (nowMs + this.failureWindowMs) } : { count: 1, until: nowMs + this.failureWindowMs };
      this.failures.set(key, next);
      throw new WmitError('LOGIN_INVALID', 'Invalid WMIT username or password.');
    }
    this.failures.delete(key);
    const token = crypto.randomBytes(36).toString('hex');
    const expires = new Date(nowMs + this.sessionTtlMs).toISOString();
    this.insertSession.run(token, account.username, account.role, this.now(), expires);
    this.audit('USER:' + account.username, 'LOGIN', account.username, { role: account.role });
    return { session_token: token, username: account.username, display_name: account.display_name, role: account.role, expires_at: expires };
  }

  sessionFor(token) {
    if (!token) return null;
    const session = this.selectSession.get(String(token));
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= this.clock().getTime()) {
      this.deleteSession.run(session.token);
      return null;
    }
    // Sliding expiry: active use extends the session.
    const extended = new Date(this.clock().getTime() + this.sessionTtlMs).toISOString();
    this.db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token = ?').run(extended, session.token);
    return { token: session.token, username: session.username, role: session.role, expires_at: extended };
  }

  logout(token) {
    if (!token) return { ok: true };
    const session = this.selectSession.get(String(token));
    this.deleteSession.run(String(token));
    if (session) this.audit('USER:' + session.username, 'LOGOUT', session.username, {});
    return { ok: true };
  }

  listAccounts() {
    return this.listAccountsStatement.all().map((account) => ({ username: account.username, display_name: account.display_name, role: account.role, status: account.status }));
  }

  audit(actor, action, entityId, details) {
    try {
      this.db.prepare('INSERT INTO auth_audit (audit_id, timestamp, actor, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)')
        .run('AUTH-' + crypto.randomUUID(), this.now(), actor || 'SYSTEM', action, entityId || '', JSON.stringify(details || {}));
    } catch (_) {
      this.db.exec('CREATE TABLE IF NOT EXISTS auth_audit (audit_id TEXT PRIMARY KEY, timestamp TEXT, actor TEXT, action TEXT, entity_id TEXT, details TEXT)');
      this.db.prepare('INSERT INTO auth_audit (audit_id, timestamp, actor, action, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)')
        .run('AUTH-' + crypto.randomUUID(), this.now(), actor || 'SYSTEM', action, entityId || '', JSON.stringify(details || {}));
    }
  }
}

module.exports = { AuthStore, hashPassword, passwordMatches, PASSWORD_ITERATIONS, ROLES };
