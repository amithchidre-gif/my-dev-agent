'use strict';

/**
 * engine.js — Test Execution Engine
 *
 * A self-contained, fault-tolerant test runner that:
 *   - Maps strategy names to concrete CLI commands
 *   - Enforces per-stage timeouts (configurable, default 30s)
 *   - Retries failed stages once automatically
 *   - Captures stdout/stderr with bounded length
 *   - Returns structured results per stage
 *
 * Usage:
 *   const engine = new TestExecutionEngine({ cwd: '/project', timeout: 30000 });
 *   const result = await engine.execute(['unit', 'integration', 'e2e']);
 */

const path              = require('path');
const fs                = require('fs');
const os                = require('os');
const { runWithTimeout } = require('./runner');

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;          // retry once per stage
const MAX_STDOUT_LEN      = 8_000;      // keep responses bounded
const MAX_STDERR_LEN      = 4_000;

/** Canonical ordering — stages always run in this sequence. */
const STAGE_ORDER = ['unit', 'integration', 'e2e', 'ai_tests'];

/**
 * Maps a stage name to a concrete shell command.
 * Returns null for unknown stages (handled as an error).
 */
const COMMAND_MAP = {
  unit:        () => 'npx vitest run --reporter=verbose',
  integration: () => 'npx vitest run --config vitest.integration.config.ts --reporter=verbose',
  e2e:         () => 'npx playwright test --reporter=list',
  ai_tests:    () => `node ${path.join(__dirname, 'ai-tests.js')}`,
};

// ── Engine ───────────────────────────────────────────────────────────────────

class TestExecutionEngine {
  /**
   * @param {{
   *   cwd?:        string,
   *   timeout?:    number,
   *   maxRetries?: number,
   *   stopOnFail?: boolean,
   *   onStageStart?: (stage: string, attempt: number) => void,
   *   onStageEnd?:   (stage: string, result: StageResult) => void,
   * }} opts
   */
  constructor(opts = {}) {
    this.cwd        = opts.cwd        || process.cwd();
    this.timeout    = opts.timeout    || DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.stopOnFail = opts.stopOnFail ?? true;
    this.projectMemory = opts.projectMemory || '';
    this.aiTestInput   = opts.aiTestInput   || null; // Array of test cases for ai_tests

    // Optional lifecycle hooks
    this._onStageStart = opts.onStageStart || (() => {});
    this._onStageEnd   = opts.onStageEnd   || (() => {});
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Execute requested test stages in canonical order.
   *
   * @param {string[]} strategies  — e.g. ['unit', 'e2e']
   * @returns {Promise<EngineResult>}
   *
   * @typedef {Object} EngineResult
   * @property {'passed'|'failed'|'partial'} status
   * @property {StageResult[]}               stages
   * @property {{ stage: string, error: string }[]} failures
   * @property {number}                      duration_ms
   */
  async execute(strategies) {
    const startAll = Date.now();

    // Use projectMemory to adjust behavior (e.g., max retries)
    if (this.projectMemory) {
      // Example: parse max retries from PROJECT_MEMORY.md rules
      const match = this.projectMemory.match(/Max (\d+) retries/i);
      if (match) {
        const max = parseInt(match[1], 10);
        if (!isNaN(max)) {
          this.maxRetries = max;
        }
      }
      // Log project context for future validation/behavior adjustment
      console.log('[engine] PROJECT_MEMORY loaded. Rules/context will influence test execution.');
    }

    // Filter & order
    const ordered = STAGE_ORDER.filter(s => strategies.includes(s));
    const unknown = strategies.filter(s => !STAGE_ORDER.includes(s));

    const stages   = [];
    const failures = [];
    let   stopped  = false;

    // Flag unknown strategies immediately
    for (const name of unknown) {
      const result = StageResult.error(name, `Unknown test strategy: "${name}"`);
      stages.push(result);
      failures.push({ stage: name, error: result.error });
    }

    for (const stage of ordered) {
      if (stopped) {
        stages.push(StageResult.skipped(stage));
        continue;
      }

      const result = await this._runWithRetry(stage);
      stages.push(result);

      if (result.status === 'failed') {
        failures.push({ stage, error: result.error });
        if (this.stopOnFail) stopped = true;
      }
    }

    const overall = failures.length === 0
      ? 'passed'
      : stopped ? 'failed' : 'partial';

    return {
      status:      overall,
      stages,
      failures,
      duration_ms: Date.now() - startAll,
    };
  }

  /**
   * Execute a single stage (no ordering, no retry).
   * Useful for targeted re-runs.
   */
  async executeSingle(stage) {
    return this._runOnce(stage, 1);
  }

  /** List all known stage names. */
  static knownStages() {
    return [...STAGE_ORDER];
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * Run one stage with automatic retry on failure.
   * @param {string} stage
   * @returns {Promise<StageResult>}
   */
  async _runWithRetry(stage) {
    let last;

    for (let attempt = 1; attempt <= 1 + this.maxRetries; attempt++) {
      this._onStageStart(stage, attempt);

      last = await this._runOnce(stage, attempt);

      this._onStageEnd(stage, last);

      if (last.status === 'passed') return last;

      if (attempt <= this.maxRetries) {
        console.warn(
          `[engine] stage "${stage}" attempt ${attempt} failed — retrying (${attempt}/${this.maxRetries})…`
        );
      }
    }

    return last;
  }

  /**
   * Execute a single attempt of a stage.
   * @param {string} stage
   * @param {number} attempt
   * @returns {Promise<StageResult>}
   */
  async _runOnce(stage, attempt) {
    const cmdFn = COMMAND_MAP[stage];
    if (!cmdFn) {
      return StageResult.error(stage, `No command mapping for stage "${stage}"`);
    }

    const cmd   = cmdFn();
    const start = Date.now();

    // Prepare env overrides for ai_tests stage
    let env = undefined;
    let tmpInputFile = null;
    if (stage === 'ai_tests' && this.aiTestInput) {
      try {
        tmpInputFile = path.join(os.tmpdir(), `ai-test-input-${Date.now()}.json`);
        fs.writeFileSync(tmpInputFile, JSON.stringify({ cases: this.aiTestInput }));
        env = { AI_TEST_INPUT: tmpInputFile };
      } catch (e) {
        console.warn('[engine] Could not write AI test input file:', e.message);
      }
    }

    try {
      const { stdout, stderr } = await runWithTimeout(cmd, {
        timeout: this.timeout,
        cwd:     this.cwd,
        env,
      });

      // Parse AI test score from structured JSON output
      let aiScore = null;
      if (stage === 'ai_tests') {
        aiScore = _parseAiScore(stdout);
      }

      return new StageResult({
        stage,
        status:  'passed',
        attempt,
        stdout:  truncate(stdout, MAX_STDOUT_LEN),
        stderr:  truncate(stderr, MAX_STDERR_LEN),
        command: cmd,
        duration_ms: Date.now() - start,
        ...(aiScore && { aiScore }),
      });
    } catch (err) {
      const isTimeout =
        err.signal === 'SIGTERM' || /timed? ?out/i.test(err.message);

      // Try to extract partial AI score even on failure
      let aiScore = null;
      if (stage === 'ai_tests') {
        aiScore = _parseAiScore(err.stdout || '');
      }

      return new StageResult({
        stage,
        status:  'failed',
        attempt,
        error:   isTimeout
                   ? `Timeout: stage exceeded ${this.timeout}ms`
                   : (err.message || String(err)),
        stdout:  truncate(err.stdout || '', MAX_STDOUT_LEN),
        stderr:  truncate(err.stderr || '', MAX_STDERR_LEN),
        command: cmd,
        duration_ms: Date.now() - start,
        timeout: isTimeout,
        ...(aiScore && { aiScore }),
      });
    } finally {
      // Clean up temp file
      if (tmpInputFile) {
        try { fs.unlinkSync(tmpInputFile); } catch (_) {}
      }
    }
  }
}

// ── StageResult value object ─────────────────────────────────────────────────

class StageResult {
  constructor(fields) {
    this.stage       = fields.stage;
    this.status      = fields.status;        // 'passed' | 'failed' | 'skipped' | 'error'
    this.attempt     = fields.attempt ?? 0;
    this.error       = fields.error   ?? null;
    this.stdout      = fields.stdout  ?? '';
    this.stderr      = fields.stderr  ?? '';
    this.command     = fields.command  ?? null;
    this.duration_ms = fields.duration_ms ?? 0;
    this.timeout     = fields.timeout ?? false;
    this.aiScore     = fields.aiScore ?? null;  // AI test score { score, passed, results, summary }
    this.logs        = this._buildLogs();
  }

  /** Convenience: structured logs blob for the response envelope. */
  _buildLogs() {
    const parts = [];
    if (this.stdout) parts.push(`[stdout]\n${this.stdout}`);
    if (this.stderr) parts.push(`[stderr]\n${this.stderr}`);
    if (this.error)  parts.push(`[error] ${this.error}`);
    return parts.join('\n\n') || '';
  }

  /** Factory: skip result. */
  static skipped(stage) {
    return new StageResult({
      stage,
      status: 'skipped',
      error:  'Skipped because a previous stage failed.',
    });
  }

  /** Factory: immediate error (invalid stage, etc). */
  static error(stage, message) {
    return new StageResult({
      stage,
      status: 'error',
      error:  message,
    });
  }

  /** Serialisation-safe plain object. */
  toJSON() {
    return {
      stage:       this.stage,
      status:      this.status,
      attempt:     this.attempt,
      duration_ms: this.duration_ms,
      error:       this.error,
      timeout:     this.timeout,
      logs:        this.logs,
      ...(this.aiScore && { ai_score: this.aiScore }),
    };
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (!str) return '';
  if (str.length <= max) return str;
  return str.slice(0, max) + `\n…(truncated ${str.length - max} chars)`;
}

/**
 * Parse the structured JSON score from ai-tests.js stdout.
 * The last line of stdout should be a JSON blob: { score, passed, results, summary }
 */
function _parseAiScore(stdout) {
  if (!stdout) return null;
  // Find last JSON object in stdout (ai-tests.js prints it as the final line)
  const lines = stdout.trim().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.score === 'number' && typeof parsed.passed === 'boolean') {
          return parsed;
        }
      } catch (_) { /* not valid JSON, keep searching */ }
    }
  }
  return null;
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { TestExecutionEngine, StageResult, STAGE_ORDER, COMMAND_MAP };
