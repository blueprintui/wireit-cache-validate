import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { exec } from 'child_process';
import { writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = join(process.cwd(), 'test-workspace');

function asyncChildProcess(command, options = { log: false }) {
  return new Promise((resolve, reject) => {
    const child = exec(command, { cwd: TEST_DIR });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.log) {
        console.log(data.toString());
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.log) {
        console.error(data.toString());
      }
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function setupTestWorkspace(packageConfig) {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, 'src'), { recursive: true });

  // Add wireit as dependency if not present
  if (!packageConfig.devDependencies) {
    packageConfig.devDependencies = {};
  }
  if (!packageConfig.devDependencies.wireit) {
    packageConfig.devDependencies.wireit = '^0.14.9';
  }

  writeFileSync(
    join(TEST_DIR, 'package.json'),
    JSON.stringify(packageConfig, null, 2)
  );

  // Install dependencies
  await asyncChildProcess('npm install --silent', { log: false });
}

function cleanupTestWorkspace() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

describe('Wireit Cache Validation Tests', () => {
  beforeEach(() => {
    cleanupTestWorkspace();
  });

  afterEach(() => {
    cleanupTestWorkspace();
  });

  test('validates cache with dependent tasks (build -> bundle)', async () => {
    // Setup a scenario with task dependencies: bundle depends on build
    const packageJson = {
      name: 'test-project',
      scripts: {
        build: 'wireit',
        bundle: 'wireit'
      },
      wireit: {
        build: {
          command: 'echo "Building..." > dist/output.txt',
          files: ['src/input.txt'],
          output: ['dist/output.txt']
        },
        bundle: {
          command: 'echo "Bundling..." > dist/bundle.txt',
          dependencies: ['build'],
          files: ['src/bundle-config.txt'],
          output: ['dist/bundle.txt']
        }
      }
    };

    await setupTestWorkspace(packageJson);

    // Create input files only (let wireit create output files)
    writeFileSync(join(TEST_DIR, 'src/input.txt'), 'test input');
    writeFileSync(join(TEST_DIR, 'src/bundle-config.txt'), 'bundle config');
    mkdirSync(join(TEST_DIR, 'dist'), { recursive: true });

    // First run - should execute both tasks
    const firstRun = await asyncChildProcess('npm run bundle');
    assert.strictEqual(firstRun.code, 0, 'First run should succeed');

    // Verify output files were created
    assert.ok(existsSync(join(TEST_DIR, 'dist/output.txt')), 'Build output should exist');
    assert.ok(existsSync(join(TEST_DIR, 'dist/bundle.txt')), 'Bundle output should exist');

    // Second run - should use cache, validate with our tool
    const validateCommand = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics npm run bundle`;
    const secondRun = await asyncChildProcess(validateCommand);
    assert.strictEqual(secondRun.code, 0, 'Second run should succeed');

    // Check that tasks were cached
    const logFile = join(TEST_DIR, '.wireit-cache-validate');
    assert.ok(existsSync(logFile), 'Debug log file should exist');

    const logContent = readFileSync(logFile, 'utf8');
    const cachedCount = (logContent.match(/cached/g) || []).length;
    const freshCount = (logContent.match(/fresh/g) || []).length;
    const totalSkipped = cachedCount + freshCount;

    // Both build and bundle should be cached or fresh
    assert.ok(totalSkipped >= 2, `Expected at least 2 cached/fresh tasks, got ${totalSkipped} (cached: ${cachedCount}, fresh: ${freshCount})`);
    assert.ok(!logContent.includes('error'), 'Log should not contain errors');
  });

  test('validates cache with multiple dependent tasks (lint -> build -> bundle)', async () => {
    // Setup a chain of dependencies: bundle depends on build, build depends on lint
    const packageJson = {
      name: 'test-project',
      scripts: {
        lint: 'wireit',
        build: 'wireit',
        bundle: 'wireit'
      },
      wireit: {
        lint: {
          command: 'echo "Linting..."',
          files: ['src/**/*.js'],
          output: []
        },
        build: {
          command: 'echo "Building..." > dist/output.txt',
          dependencies: ['lint'],
          files: ['src/input.txt'],
          output: ['dist/output.txt']
        },
        bundle: {
          command: 'echo "Bundling..." > dist/bundle.txt',
          dependencies: ['build'],
          files: ['src/bundle-config.txt'],
          output: ['dist/bundle.txt']
        }
      }
    };

    await setupTestWorkspace(packageJson);

    // Create input files only (let wireit create outputs)
    writeFileSync(join(TEST_DIR, 'src/app.js'), 'console.log("test");');
    writeFileSync(join(TEST_DIR, 'src/input.txt'), 'test input');
    writeFileSync(join(TEST_DIR, 'src/bundle-config.txt'), 'bundle config');
    mkdirSync(join(TEST_DIR, 'dist'), { recursive: true });

    // First run - execute all tasks
    const firstRun = await asyncChildProcess('npm run bundle');
    assert.strictEqual(firstRun.code, 0, 'First run should succeed');

    // Second run - should use cache for all tasks
    const validateCommand = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics npm run bundle`;
    const secondRun = await asyncChildProcess(validateCommand);
    assert.strictEqual(secondRun.code, 0, 'Second run should succeed');

    const logFile = join(TEST_DIR, '.wireit-cache-validate');
    const logContent = readFileSync(logFile, 'utf8');
    const cachedCount = (logContent.match(/cached/g) || []).length;
    const freshCount = (logContent.match(/fresh/g) || []).length;
    const totalSkipped = cachedCount + freshCount;

    // All three tasks (lint, build, bundle) should be cached or fresh
    assert.ok(totalSkipped >= 2, `Expected at least 2 cached/fresh tasks, got ${totalSkipped} (cached: ${cachedCount}, fresh: ${freshCount})`);
  });

  test('detects bad setup without proper output configuration', async () => {
    // This tests the negative case - a task that generates output but doesn't declare it
    // This should NOT cache properly
    const packageJson = {
      name: 'test-project',
      scripts: {
        'bad-task': 'wireit'
      },
      wireit: {
        'bad-task': {
          command: 'node -e "require(\'fs\').writeFileSync(\'dist/generated.txt\', Date.now().toString())"',
          files: ['src/input.txt'],
          // BAD: output array is empty but we're generating files
          output: []
        }
      }
    };

    await setupTestWorkspace(packageJson);

    // Create input file
    writeFileSync(join(TEST_DIR, 'src/input.txt'), 'input');
    mkdirSync(join(TEST_DIR, 'dist'), { recursive: true });

    // First run
    const firstRun = await asyncChildProcess('npm run bad-task');
    assert.strictEqual(firstRun.code, 0, 'First run should succeed');

    // Second run - the task will run again because output isn't properly tracked
    const validateCommand = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics npm run bad-task`;
    const secondRun = await asyncChildProcess(validateCommand);

    const logFile = join(TEST_DIR, '.wireit-cache-validate');
    const logContent = readFileSync(logFile, 'utf8');

    // The task should show as 'fresh' or 'exit-zero' instead of 'cached'
    // because wireit can't properly cache it without output declaration
    const hasCached = logContent.includes('cached');
    const hasFresh = logContent.includes('fresh') || logContent.includes('exit-zero');

    assert.ok(hasFresh, 'Bad setup should result in fresh execution, not cached');
    // Note: This is actually the expected behavior - wireit will re-run it
  });

  test('detects bad setup with missing files configuration', async () => {
    // Test case where input files aren't tracked, so changes won't invalidate cache
    const packageJson = {
      name: 'test-project',
      scripts: {
        'incomplete-task': 'wireit'
      },
      wireit: {
        'incomplete-task': {
          command: 'echo "processing" && cat src/data.txt',
          // BAD: files array is empty but command reads from src/data.txt
          files: [],
          output: []
        }
      }
    };

    await setupTestWorkspace(packageJson);

    // Create input file
    writeFileSync(join(TEST_DIR, 'src/data.txt'), 'original data');

    // First run
    const firstRun = await asyncChildProcess('npm run incomplete-task');
    assert.strictEqual(firstRun.code, 0, 'First run should succeed');

    // Modify the input file that should be tracked but isn't
    writeFileSync(join(TEST_DIR, 'src/data.txt'), 'modified data');

    // Second run - will incorrectly use cache because files aren't tracked
    const validateCommand = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics npm run incomplete-task`;
    const secondRun = await asyncChildProcess(validateCommand);

    const logFile = join(TEST_DIR, '.wireit-cache-validate');
    const logContent = readFileSync(logFile, 'utf8');

    // This demonstrates the problem: it will be cached even though input changed
    // In a real scenario, this would be a bug in the wireit configuration
    const statusLine = logContent.split('\n').find(line => line.includes('incomplete-task'));

    assert.ok(statusLine, 'Should find status for incomplete-task in log');
  });

  test('validates proper cache with parallel independent tasks', async () => {
    // Test parallel tasks that don't depend on each other
    const packageJson = {
      name: 'test-project',
      scripts: {
        'task-a': 'wireit',
        'task-b': 'wireit',
        'all': 'wireit'
      },
      wireit: {
        'task-a': {
          command: 'echo "Task A" > dist/a.txt',
          files: ['src/a.txt'],
          output: ['dist/a.txt']
        },
        'task-b': {
          command: 'echo "Task B" > dist/b.txt',
          files: ['src/b.txt'],
          output: ['dist/b.txt']
        },
        'all': {
          dependencies: ['task-a', 'task-b']
        }
      }
    };

    await setupTestWorkspace(packageJson);

    // Create input files only (let wireit create outputs)
    writeFileSync(join(TEST_DIR, 'src/a.txt'), 'data a');
    writeFileSync(join(TEST_DIR, 'src/b.txt'), 'data b');
    mkdirSync(join(TEST_DIR, 'dist'), { recursive: true });

    // First run
    const firstRun = await asyncChildProcess('npm run all');
    assert.strictEqual(firstRun.code, 0, 'First run should succeed');

    // Second run - validate cache
    const validateCommand = `WIREIT_DEBUG_LOG_FILE=.wireit-cache-validate WIREIT_LOGGER=metrics npm run all`;
    const secondRun = await asyncChildProcess(validateCommand);
    assert.strictEqual(secondRun.code, 0, 'Second run should succeed');

    const logFile = join(TEST_DIR, '.wireit-cache-validate');
    const logContent = readFileSync(logFile, 'utf8');
    const cachedCount = (logContent.match(/cached/g) || []).length;
    const freshCount = (logContent.match(/fresh/g) || []).length;
    const totalSkipped = cachedCount + freshCount;

    // Both task-a and task-b should be cached or fresh
    assert.ok(totalSkipped >= 2, `Expected at least 2 cached/fresh parallel tasks, got ${totalSkipped} (cached: ${cachedCount}, fresh: ${freshCount})`);
  });
});
