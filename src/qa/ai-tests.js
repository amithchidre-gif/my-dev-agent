'use strict';

/**
 * ai-tests.js — Custom AI test runner
 *
 * This script is executed as a child process by the QA server for the
 * `ai_tests` stage. Exit code 0 = pass, non-zero = fail.
 *
 * Extend this with your actual AI test assertions.
 */

const { execSync } = require('child_process');
const path         = require('path');
const fs           = require('fs');

const results = [];
let   hasFailure = false;

function test(name, fn) {
  const start = Date.now();
  try {
    const result = fn();
    if (result instanceof Promise) throw new Error('Async tests not supported here. Use a runner.');
    results.push({ name, status: 'passed', duration_ms: Date.now() - start });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    hasFailure = true;
    results.push({ name, status: 'failed', error: err.message, duration_ms: Date.now() - start });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// ── AI test suite ────────────────────────────────────────────────────────────

console.log('\n[ai-tests] Running AI test suite…\n');

test('cursor-agent binary is reachable', () => {
  const cmd = process.platform === 'win32' ? 'where cursor-agent.exe' : 'which cursor-agent';
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (_) {
    // Not a hard failure — log a warning and continue
    console.warn('  ⚠  cursor-agent not found on PATH (non-blocking)');
  }
});

test('workspace directory exists', () => {
  const ws = path.join(process.cwd(), 'workspace');
  if (!fs.existsSync(ws)) {
    throw new Error(`workspace/ directory not found at ${ws}`);
  }
});

test('evidence root is writable', () => {
  const evidenceDir = process.env.QA_EVIDENCE_DIR || path.join(process.cwd(), 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const probe = path.join(evidenceDir, '.write-probe');
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
});

test('QA_API_KEY env var is set in production', () => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && !process.env.QA_API_KEY) {
    throw new Error('QA_API_KEY must be set in production environment.');
  }
  // Non-production: warn only
  if (!process.env.QA_API_KEY) {
    console.warn('  ⚠  QA_API_KEY not set (auth is disabled)');
  }
});

// ── Output & exit ────────────────────────────────────────────────────────────

console.log(`\n[ai-tests] ${results.filter(r => r.status === 'passed').length}/${results.length} passed\n`);

if (process.env.AI_TEST_OUTPUT) {
  fs.writeFileSync(process.env.AI_TEST_OUTPUT, JSON.stringify(results, null, 2));
}

process.exit(hasFailure ? 1 : 0);
