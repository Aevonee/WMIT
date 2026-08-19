'use strict';

// Hosted WMIT server entry point.
//
// Configure with environment variables or a .env file (see
// docs/deployment-netcup.md). Development defaults keep the server on
// loopback with sessions optional; staging and production require sign-in.

const { createHostedServer } = require('../src/server/hosted');

const { server, config, scheduler } = createHostedServer({});

const listening = () => {
  console.log('WMIT hosted server (' + config.env + ') listening on ' + (typeof config.port === 'number' ? config.host + ':' + config.port : config.port));
  console.log('Sessions enforced: ' + config.enforceSessions + ' · Database: ' + config.dbPath);
  if (!config.smtpConfigured()) console.log('SMTP not configured — outgoing email will be written as .eml drafts to ' + config.outboxDir);
  if (scheduler.running) console.log('Scheduler running jobs: ' + scheduler.jobNames().join(', '));
};

if (typeof config.port === 'number') server.listen(config.port, config.host, listening);
else server.listen(config.port, listening);

function shutdown(signal) {
  console.log('WMIT: ' + signal + ' received, shutting down.');
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
