'use strict';

/**
 * QA Agent Server — Production-grade
 *
 * Routes:
 *   POST /api/qa/run      — execute a QA job
 *   GET  /api/qa/status   — health + cache stats
 *
 * Delegates all test execution to TestExecutionEngine (qa/engine.js).
 */

const express                        = require('express');
const { TestExecutionEngine }        = require('./qa/engine');
const { saveEvidence }               = require('./qa/evidence');
const { QACache }                    = require('./qa/cache');
const { validateQARequest }          = require('./qa/validate');
const { buildResponse }              = require('./qa/response');

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

// ── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/qa/run', requireApiKey, async (req, res) => {
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

  // 3. Run tests via execution engine
  const engine = new TestExecutionEngine({
    cwd:        workspace,
    timeout:    30_000,
    maxRetries: 1,
    stopOnFail: true,
    onStageStart(stage, attempt) {
      console.log(`[qa] ${ticketId} | stage "${stage}" attempt ${attempt} starting…`);
    },
    onStageEnd(stage, result) {
      console.log(`[qa] ${ticketId} | stage "${stage}" → ${result.status} (${result.duration_ms}ms)`);
    },
  });

  const engineResult = await engine.execute(test_strategy);

  // 4. Save evidence for every stage
  let evidenceDir = null;
  for (const stageResult of engineResult.stages) {
    try {
      evidenceDir = await saveEvidence(ticketId, stageResult.stage, stageResult);
    } catch (e) {
      console.warn(`[qa] evidence save failed for ${stageResult.stage}:`, e.message);
    }
  }

  // 5. Convert engine stages array → object keyed by stage name (for response)
  const stagesMap = {};
  for (const sr of engineResult.stages) {
    stagesMap[sr.stage] = sr;
  }

  // 6. Build response
  const payload = buildResponse({
    ticketId,
    stages:     stagesMap,
    failures:   engineResult.failures,
    evidenceDir,
    durationMs: engineResult.duration_ms,
  });

  // 7. Cache only if fully passed
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

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[qa-server] Listening on port ${PORT}`);
  if (!API_KEY) console.warn('[qa-server] WARNING: QA_API_KEY not set — auth disabled');
});

module.exports = app; // for tests
