#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const testsDir = path.join(__dirname, 'tests');
const testFiles = fs
  .readdirSync(testsDir)
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => path.join('tests', name));

if (testFiles.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

const nodeResult = spawnSync(process.execPath, ['--test', ...testFiles], {
  stdio: 'inherit',
});

if (nodeResult.error) {
  console.error(nodeResult.error.message);
  process.exit(1);
}
if ((nodeResult.status ?? 1) !== 0) {
  process.exit(nodeResult.status ?? 1);
}

const pythonResult = spawnSync('python', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', '*_py_test.py'], {
  stdio: 'inherit',
});

if (pythonResult.error) {
  console.error(pythonResult.error.message);
  process.exit(1);
}

process.exit(pythonResult.status ?? 1);
