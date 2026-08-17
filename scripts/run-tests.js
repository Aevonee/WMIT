'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testRoot = path.join(__dirname, '..', 'tests');
const files = [];

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(fullPath);
  });
}

walk(testRoot);
files.sort();

if (!files.length) {
  console.error('No test files found.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
