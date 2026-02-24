#!/usr/bin/env node

import { exec } from 'child_process';
import { readFileSync, rmSync, existsSync } from 'fs';

const args = process.argv.slice(2).join(' ');
const logFile = '.wireit-cache-validate';

function asyncChildProcess(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    child.addListener("error", reject);
    child.stderr.on('data', (data) => { stderr += data.toString(); });
    child.addListener("exit", (code) => resolve({ code, stderr }));
  });
}

const { code, stderr } = await asyncChildProcess(
  exec(args, {
    env: { ...process.env, WIREIT_DEBUG_LOG_FILE: logFile, WIREIT_LOGGER: 'metrics' }
  })
);

if (code !== 0) {
  console.error(`🚫 Command failed with exit code ${code}.`);
  if (stderr) {
    console.error(stderr);
  }
  process.exit(1);
}

if (!existsSync(logFile)) {
  console.error('🚫 Cache validation log not found. Did the wireit command run successfully?');
  process.exit(1);
}

const log = readFileSync(logFile, 'utf8');

if (log.includes('<error>') || log.includes('<failure>')) {
  console.error('🚫 Cache validation failed. Verify all scripts pass without failure.');
  console.error(log);
  process.exit(1);
}

// Statuses indicating a task was skipped or completed without needing re-execution.
// 'fresh': wireit determined the task fingerprint (inputs) is unchanged, no re-run needed.
// 'cached': wireit restored outputs from cache.
const passingStatuses = ['analysis-started', 'analysis-completed', 'fresh', 'no-command', 'cached', 'exit-zero'];

const statusLines = log.split('\n').filter(line => line.includes('<success>') || line.includes('<info>'));
const statuses = statusLines.map(line => line.split('> ')[1]).map(s => s.trim());
const cacheFailures = statuses.filter(status => !passingStatuses.includes(status));
const failedTasks = log.split('\n').filter(line => line.includes('🏃')).map(l => l.replace('🏃', '').trim());

if (cacheFailures.length) {
  console.error(failedTasks.join('\n'));
  console.error('🚫 Cache validation failed. Check .wireit-cache-validate log to verify all scripts are cached correctly.\nhttps://github.com/google/wireit?tab=readme-ov-file#caching');
  process.exit(1);
} else {
  console.log('✅ Cache validation passed.');
  rmSync(logFile, { force: true });
}
