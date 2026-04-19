'use strict';

/**
 * runner.js — Command execution with timeout support
 */

const { exec }  = require('child_process');
const util      = require('util');
const execAsync = util.promisify(exec);

/**
 * Runs a shell command with a hard timeout.
 * Rejects with an enriched error (stdout/stderr preserved) on failure or timeout.
 *
 * @param {string} cmd
 * @param {{ timeout?: number, cwd?: string }} opts
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runWithTimeout(cmd, { timeout = 30_000, cwd = process.cwd(), env } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = env ? { ...process.env, ...env } : undefined;
    const child = exec(
      cmd,
      { cwd, timeout, killSignal: 'SIGTERM', maxBuffer: 10 * 1024 * 1024, ...(childEnv && { env: childEnv }) },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout || '';
          err.stderr = stderr || '';
          return reject(err);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );

    // Belt-and-suspenders: kill after timeout + 2s grace period
    const watchdog = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) {}
      const err    = new Error(`Process timed out after ${timeout}ms`);
      err.signal   = 'SIGTERM';
      err.stdout   = '';
      err.stderr   = '';
      reject(err);
    }, timeout + 2_000);

    child.on('close', () => clearTimeout(watchdog));
  });
}

module.exports = { runWithTimeout };
