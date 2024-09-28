#!/usr/bin/env node

import { exec } from 'child_process';
import { readFileSync, rmSync } from 'fs';

const command = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics ${process.argv.slice(2).join(' ')}`;

function asyncChildProcess(child, options = { log: true }) {
  return new Promise((resolve, reject) => {
      child.addListener("error", reject);
      child.addListener("exit", resolve);
      if (options.log) {
        child.stdout.on('data', (data) => console.log(data.toString()));
      }
  });
}

await asyncChildProcess(exec(command), { log: false });

const log = readFileSync('.wireit-cache-validate', 'utf8').toString();

if (log.includes('error') || log.includes('fail')) {
  console.error('🚫 Cache validation failed. Verify all scripts pass without failure.');
  console.error(log);
  process.exit(1);
}

const passingStatuses = ['analysis-started', 'analysis-completed', 'fresh', 'no-command', 'cached', 'exit-zero'];

const statuses = log.split('\n').filter(line => line.includes('<success>') || line.includes('<info>')).map(line => line.split('> ')[1]).map(line => line.trim());
const cacheFailures = statuses.filter(status => !passingStatuses.includes(status));
const failedTasks = log.split('\n').filter(line => line.includes('🏃')).map(log => log.replace('🏃', '').trim())
if (cacheFailures.length) {
  console.error(failedTasks.join('\n'));
  console.error('🚫 Cache validation failed. Check .wireit-cache-validate log to verify all scripts are cached correctly.\nhttps://github.com/google/wireit?tab=readme-ov-file#caching');
  process.exit(1);
} else {
  console.log('✅ Cache validation passed.');
  rmSync('.wireit-cache-validate', { force: true });
}
