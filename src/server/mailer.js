'use strict';

// Mail delivery for the hosted server.
//
// With SMTP credentials configured, this sends through your mail provider
// (for example the netcup mailbox on your domain) using a minimal dependency-
// free SMTP client (STARTTLS on 587, implicit TLS on 465, AUTH PLAIN/LOGIN).
// Without credentials it degrades to writing .eml drafts into the outbox
// directory so nothing is silently lost and every message remains reviewable.

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');

class SmtpClient {
  constructor(options) {
    const opts = options || {};
    this.host = opts.host;
    this.port = Number(opts.port || 587);
    this.mode = opts.mode || 'starttls'; // starttls | tls | plain
    this.username = opts.username || '';
    this.password = opts.password || '';
    this.timeoutMs = Number(opts.timeoutMs || 20000);
  }

  connect() {
    return new Promise((resolve, reject) => {
      if (this.mode === 'tls') {
        const socket = tls.connect({ host: this.host, port: this.port, servername: this.host, rejectUnauthorized: true }, () => resolve(this.upgrade(socket)));
        socket.once('error', reject);
        return;
      }
      const socket = net.connect({ host: this.host, port: this.port }, () => resolve(this.upgrade(socket)));
      socket.once('error', reject);
    });
  }

  upgrade(socket) {
    this.socket = socket;
    this.buffer = '';
    this.pending = [];
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      this.buffer += chunk;
      // A reply can contain multiple lines; the final line is "NNN<space>text".
      const match = this.buffer.match(/(?:^|\r?\n)(\d{3} [^\r\n]*)\r?\n$/);
      if (match) {
        const line = match[1];
        this.buffer = '';
        const waiter = this.pending.shift();
        if (waiter) waiter({ code: Number(line.slice(0, 3)), line });
      }
    });
    return this;
  }

  readResponse() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('SMTP timeout waiting for server response.')), this.timeoutMs);
      this.pending.push((response) => { clearTimeout(timer); resolve(response); });
    });
  }

  async command(expected, text) {
    if (text !== undefined) this.socket.write(text + '\r\n');
    const response = await this.readResponse();
    if (!String(expected).split(',').includes(String(response.code))) {
      throw new Error('SMTP command failed (' + response.line + ')');
    }
    return response;
  }

  async startTls() {
    this.socket.write('STARTTLS\r\n');
    const response = await this.readResponse();
    if (response.code !== 220) throw new Error('STARTTLS refused: ' + response.line);
    await new Promise((resolve, reject) => {
      const secure = tls.connect({ socket: this.socket, servername: this.host, rejectUnauthorized: true }, () => {
        this.upgrade(secure);
        resolve();
      });
      secure.once('error', reject);
    });
  }

  quit() { try { this.socket.write('QUIT\r\n'); this.socket.end(); } catch (_) { /* already closed */ } }
}

function buildMessage(options) {
  const opts = options || {};
  const boundary = 'wmit-' + crypto.randomBytes(12).toString('hex');
  const from = opts.fromName ? '"' + String(opts.fromName).replace(/"/g, '') + '" <' + opts.fromEmail + '>' : opts.fromEmail;
  const headers = [
    'From: ' + from,
    'To: ' + opts.to,
    'Subject: ' + String(opts.subject || '').replace(/[\r\n]/g, ' '),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomUUID() + '@wmit.local>',
    'MIME-Version: 1.0'
  ];
  if (opts.replyTo) headers.push('Reply-To: ' + opts.replyTo);
  let body;
  if (opts.html) {
    headers.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
    body = [
      '--' + boundary,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      String(opts.text || ''),
      '',
      '--' + boundary,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      String(opts.html),
      '',
      '--' + boundary + '--'
    ].join('\r\n');
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    body = String(opts.text || '');
  }
  // Dot-stuffing per RFC 5321 DATA transparency rules.
  body = body.replace(/\r?\n\./g, '\n..');
  return headers.join('\r\n') + '\r\n\r\n' + body;
}

class Mailer {
  constructor(options) {
    const opts = options || {};
    this.smtp = opts.smtp || {};
    this.outboxDir = opts.outboxDir;
  }

  get configured() {
    return Boolean(this.smtp.host && this.smtp.username && this.smtp.password && this.smtp.fromEmail);
  }

  async send(message) {
    if (!this.configured) {
      const file = this.writeOutbox(message);
      return { sent: false, mode: 'eml_file', path: file };
    }
    const client = new SmtpClient(Object.assign({}, this.smtp));
    try {
      await client.connect();
      await client.command(220);
      await client.command(250, 'EHLO wmit.local');
      if (client.mode !== 'tls') {
        await client.startTls();
        await client.command(250, 'EHLO wmit.local');
      }
      const credentials = Buffer.from('\u0000' + this.smtp.username + '\u0000' + this.smtp.password).toString('base64');
      try {
        await client.command(235, 'AUTH PLAIN ' + credentials);
      } catch (_) {
        await client.command(334, 'AUTH LOGIN');
        await client.command(334, Buffer.from(this.smtp.username).toString('base64'));
        await client.command(235, Buffer.from(this.smtp.password).toString('base64'));
      }
      await client.command(250, 'MAIL FROM:<' + this.smtp.fromEmail + '>');
      await client.command(250, 'RCPT TO:<' + message.to + '>');
      await client.command(354, 'DATA');
      const payload = buildMessage({
        to: message.to, subject: message.subject, text: message.text, html: message.html,
        fromEmail: this.smtp.fromEmail, fromName: this.smtp.fromName, replyTo: message.replyTo
      });
      await client.command(250, payload + '\r\n.');
      client.quit();
      return { sent: true, mode: 'smtp' };
    } finally {
      try { client.quit(); } catch (_) { /* connection already closed */ }
    }
  }

  writeOutbox(message) {
    if (!this.outboxDir) return null;
    fs.mkdirSync(this.outboxDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeTo = String(message.to || 'unknown').replace(/[^A-Za-z0-9@._-]/g, '_');
    const file = path.join(this.outboxDir, stamp + '-' + safeTo + '.eml');
    fs.writeFileSync(file, buildMessage({
      to: message.to, subject: message.subject, text: message.text, html: message.html,
      fromEmail: this.smtp.fromEmail || 'wmit@unconfigured.local', fromName: this.smtp.fromName, replyTo: message.replyTo
    }), 'utf8');
    return file;
  }
}

module.exports = { Mailer, SmtpClient, buildMessage };
