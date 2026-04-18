'use strict';

/**
 * QA Agent Server — Production-grade
 *
 * Routes:
 *   POST /api/qa/run      — execute a QA job
 *   GET  /api/qa/status   — health + cache stats
 */

const express    = require('express');
const { runWithTimeout }                  = require('./qa/runner');
const { saveEvidence }                = require('./qa/evidence');
const { QACache }                     = require('./qa/cache');
const { validateQARequest }           = require('./qa/validate');
const { buildResponse }               = require('./qa/response');

const app  = express();
const PORT = process.env.QA_PORT || 3003;

app.use(express.json());

// ── Auth middleware ─────────────────────────────────────────────────────────
const API_KEY = process.env.QA_API_KEY || '';

function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // key not configured → open (dev mode)
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json({ status: 'error', message: 'Invalid or missing X-API-Key.' });
  }
  next();
}

// ── Cache ───────────────────────────────────────────────────────────────────
const cache = new QACache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });

// ── Stage ordering ──────────────────────────────────────────────────────────
const STAGE_ORDER = ['unit', 'integration', 'e2e', 'ai_tests'];

// ── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/qa/run', requireApiKey, async (req, res) => {
  const started = Date.now();

  // 1. Validate
  const { valid, errors, body } = validateQARequest(req.body);
  if (!valid) {
    return res.status(400).json({ status: 'error', message: 'Validation failed.', errors });
  }

  const { ticketId, test_strategy, workspace = process.cwd() } = body;

  // 2. Cache hit
  const cacheKey = `${ticketId}:${JSON.stringify(test_strategy)}`;
  const cached   = cache.get(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  // 3. Order and filter requested stages
  const requestedStages = STAGE_ORDER.filter(s => test_strategy.includes(s));

  const stages   = {};
  const failures = [];
  let   stopped  = false;
  let   evidenceDir = null;

  // 4. Run each stage in order
  for (const stage of requestedStages) {
    if (stopped) {
      stages[stage] = { status: 'skipped', reason: 'previous stage failed' };
      continue;
    }

    const stageResult = await runStageWithRetry(stage, { ticketId, workspace });

    stages[stage] = stageResult;

    if (stageResult.status === 'failed') {
      failures.push({ stage, error: stageResult.error });
      stopped = true;
    }

    // Save evidence regardless of pass/fail
    try {
      evidenceDir = await saveEvidence(ticketId, stage, stageResult);
    } catch (e) {
      console.warn(`[qa] evidence save failed for ${stage}:`, e.message);
    }
  }

  // 5. Build response
  const payload = buildResponse({
    ticketId,
    stages,
    failures,
    evidenceDir,
    durationMs: Date.now() - started,
  });

  // 6. Cache only if fully passed
  if (payload.status === 'passed') {
    cache.set(cacheKey, payload);
  }

  const httpStatus = payload.status === 'passed' ? 200 : 207;
  return res.status(httpStatus).json(payload);
});

app.get('/api/qa/status', requireApiKey, (_req, res) => {
  res.json({
    status: 'ok',
    cache: cache.stats(),
    uptime_s: Math.floor(process.uptime()),
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function runStageWithRetry(stage, ctx) {
  let lastResult;

  for (let attempt = 1; attempt <= 2; attempt++) {
    lastResult = await runStage(stage, ctx, attempt);
    if (lastResult.status !== 'failed') break;
    if (attempt < 2) {
      console.warn(`[qa] stage "${stage}" attempt ${attempt} failed — retrying…`);
    }
  }

  return lastResult;
}

async function runStage(stage, { ticketId, workspace }, attempt = 1) {
  const TIMEOUT_MS = 30_000;
  const start      = Date.now();

  try {
    const { stdout, stderr } = await runWithTimeout(
      buildCommand(stage, workspace),
      { timeout: TIMEOUT_MS, cwd: workspace }
    );

    return {
      status:     'passed',
      attempt,
      stdout:     stdout.slice(0, 4000),
      stderr:     stderr.slice(0, 1000),
      duration_ms: Date.now() - start,
    };
  } catch (err) {
    const isTimeout = err.signal === 'SIGTERM' || /timed? ?out/i.test(err.message);
    return {
      status:     'failed',
      attempt,
      error:      isTimeout ? `Timeout after ${TIMEOUT_MS}ms` : (err.message || String(err)),
      stdout:     (err.stdout || '').slice(0, 4000),
      stderr:     (err.stderr || '').slice(0, 1000),
      duration_ms: Date.now() - start,
    };
  }
}

function buildCommand(stage, workspace) {
  switch (stage) {
    case 'unit':
      return 'npx vitest run --reporter=verbose';
    case 'integration':
      return 'npx vitest run --config vitest.integration.config.ts --reporter=verbose';
    case 'e2e':
      return 'npx playwright test --reporter=list';
    case 'ai_tests':
      return `node ${require('path').join(__dirname, 'qa', 'ai-tests.js')}`;
    default:
      throw new Error(`Unknown test stage: "${stage}"`);
  }
}

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[qa-server] Listening on port ${PORT}`);
  if (!API_KEY) console.warn('[qa-server] WARNING: QA_API_KEY not set — auth disabled');
});

module.exports = app; // for tests
