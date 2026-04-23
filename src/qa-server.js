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
const fs = require('fs');
const path = require('path');
const { saveEvidence }               = require('./qa/evidence');
const { QACache }                    = require('./qa/cache');
const { validateQARequest }          = require('./qa/validate');
const { buildResponse, buildFailureResponse } = require('./qa/response');
const { shouldEscalate, buildEscalationResponse, RetryTracker } = require('./qa/retry-guard');
const { generateFixTicket, FixTicketRegistry } = require('./qa/cto-agent');
const { runFeedbackLoop }                      = require('./qa/feedback-loop');
const memory                                   = require('./memory');

const app  = express();
const PORT = process.env.QA_PORT || 3003;

app.use(express.json());

// ── Auth middleware ─────────────────────────────────────────────────────────
const API_KEY = process.env.QA_API_KEY || '';

function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // key not configured → open (dev mode)
  const key = req.headers['x-api-key'];
  if (!key || key !== API_KEY) {
    return res.status(401).json(
      buildFailureResponse(req.body?.ticketId || 'unknown', 'auth', [
        { test_name: 'api_key_check', error: 'Invalid or missing X-API-Key.' }
      ], null)
    );
  }
  next();
}

// ── Cache ───────────────────────────────────────────────────────────────────
const cache = new QACache({ ttlMs: 5 * 60 * 1000, maxEntries: 100 });

// ── Retry tracker (persists across request cycles within the process) ────────
const retryTracker = new RetryTracker();

// ── Fix-ticket registry (duplicate prevention for CTO agent) ────────────────
const fixRegistry = new FixTicketRegistry();

// ── Routes ──────────────────────────────────────────────────────────────────

app.post('/api/qa/run', requireApiKey, async (req, res) => {
  // 1. Validate
  const { valid, errors, body } = validateQARequest(req.body);
  if (!valid) {
    return res.status(400).json(
      buildFailureResponse(req.body?.ticketId || 'unknown', 'validation', [
        ...errors.map(e => ({ test_name: 'input_validation', error: e }))
      ], null)
    );
  }

  const { ticketId, test_strategy, workspace = process.cwd(), ai_test_input,
          retry_count, max_retries } = body;

  // 1a. Load PROJECT_MEMORY.md (if present)
  let projectMemory = '';
  try {
    projectMemory = memory.toMarkdown();
  } catch (e) {
    console.warn('[qa-server] Could not read project memory:', e.message);
  }
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
    projectMemory,
    aiTestInput: ai_test_input || null,
    onStageStart(stage, attempt) {
      console.log(`[qa] ${ticketId} | stage "${stage}" attempt ${attempt} starting…`);
    },
    onStageEnd(stage, result) {
      console.log(`[qa] ${ticketId} | stage "${stage}" → ${result.status} (${result.duration_ms}ms)`);
    },
  });

  const engineResult = await engine.execute(test_strategy);

  // 4. Save evidence for every stage — build stage → first-file map
  const stageEvidenceMap = {};
  for (const stageResult of engineResult.stages) {
    try {
      const evidence = saveEvidence(ticketId, stageResult.stage, stageResult);
      stageEvidenceMap[stageResult.stage] = evidence.files[0] || evidence.dir || '';
    } catch (e) {
      console.warn(`[qa] evidence save failed for ${stageResult.stage}:`, e.message);
      stageEvidenceMap[stageResult.stage] = '';
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
    stages:          stagesMap,
    failures:        engineResult.failures,
    stageEvidenceMap,
    durationMs:      engineResult.duration_ms,
  });

  // 7. Retry loop guard — only on failure
  if (payload.status === 'failed') {
    const newCount = retryTracker.increment(ticketId, { retry_count, max_retries });
    const ceiling  = retryTracker.getMaxRetries(ticketId);

    console.log(`[qa] ${ticketId} | retry_count=${newCount}/${ceiling}`);

    if (shouldEscalate(newCount, ceiling)) {
      console.warn(`[qa] ${ticketId} | max retries exceeded — escalating to CTO_Agent`);
      retryTracker.reset(ticketId);          // clean up after escalation

      const escalation = buildEscalationResponse(ticketId);

      // Auto-generate fix ticket on escalation (if original ticket is available)
      const originalTicket = req.body;
      const fixTicket = generateFixTicket(
        { ticket_id: ticketId, definition_of_done: originalTicket.definition_of_done },
        payload,
        { registry: fixRegistry }
      );
      if (fixTicket) {
        escalation.fix_ticket = fixTicket;
        console.log(`[qa] ${ticketId} | fix ticket created: ${fixTicket.ticket_id}`);
      } else {
        console.log(`[qa] ${ticketId} | fix ticket already exists — skipped duplicate`);
      }

      return res.status(200).json(escalation);
    }

    // Attach retry metadata to the failure payload
    payload.retry_count = newCount;
    payload.max_retries = ceiling;
    return res.status(207).json(payload);
  }

  // 8. Cache only if fully passed
  if (payload.status === 'passed') {
    retryTracker.reset(ticketId);            // clear retry state on success
    cache.set(cacheKey, payload);
  }

  return res.status(200).json(payload);
});

// ── CTO fix-ticket route ─────────────────────────────────────────────────────

app.post('/api/cto/fix-ticket', requireApiKey, (req, res) => {
  const { original_ticket, qa_failure } = req.body || {};

  if (!original_ticket || typeof original_ticket !== 'object') {
    return res.status(400).json({ status: 'error', message: '`original_ticket` is required.' });
  }
  if (!qa_failure || qa_failure.status !== 'failed') {
    return res.status(400).json({ status: 'error', message: '`qa_failure` must be a failed QA response.' });
  }

  const fixTicket = generateFixTicket(original_ticket, qa_failure, { registry: fixRegistry });

  if (!fixTicket) {
    return res.status(409).json({
      status:  'duplicate',
      message: 'A fix ticket already exists for this failure.',
      existing_fix: fixRegistry.lookup(
        require('./qa/cto-agent')._buildFingerprint(
          String(original_ticket.ticket_id || qa_failure.ticket_id), qa_failure
        )
      ),
    });
  }

  console.log(`[cto] Fix ticket created: ${fixTicket.ticket_id}`);
  return res.status(201).json(fixTicket);
});

// ── Orchestration: Dev ↔ QA feedback loop ────────────────────────────────────

app.post('/api/orchestrate/loop', requireApiKey, async (req, res) => {
  const { ticket, max_cycles } = req.body || {};

  if (!ticket || !ticket.ticket_id || !Array.isArray(ticket.test_strategy)) {
    return res.status(400).json({
      status: 'error',
      message: '`ticket` with `ticket_id` and `test_strategy[]` is required.',
    });
  }

  try {
    const result = await runFeedbackLoop(ticket, {
      maxCycles: max_cycles || 5,

      // QA callback — reuses the existing test-execution pipeline
      async qaFn(t) {
        const engine = new TestExecutionEngine({
          cwd:        t.workspace || process.cwd(),
          timeout:    30_000,
          maxRetries: 1,
          stopOnFail: true,
        });
        const engineResult = await engine.execute(t.test_strategy);

        const stageEvidenceMap = {};
        for (const sr of engineResult.stages) {
          try {
            const ev = saveEvidence(t.ticket_id, sr.stage, sr);
            stageEvidenceMap[sr.stage] = ev.files[0] || ev.dir || '';
          } catch (_) { stageEvidenceMap[sr.stage] = ''; }
        }

        const { buildResponse: buildResp } = require('./qa/response');
        const stagesMap = {};
        for (const sr of engineResult.stages) stagesMap[sr.stage] = sr;
        return buildResp({
          ticketId:    t.ticket_id,
          stages:      stagesMap,
          failures:    engineResult.failures,
          stageEvidenceMap,
          durationMs:  engineResult.duration_ms,
        });
      },

      // Dev callback — stub: real Dev_Agent would apply fixes here
      async devFn(fixTicket) {
        console.log(`[loop] Dev_Agent received fix ticket: ${fixTicket.ticket_id}`);
        return { status: 'applied', ticket_id: fixTicket.ticket_id };
      },

      onCycleStart(cycle) {
        console.log(`[loop] ${ticket.ticket_id} | cycle ${cycle} starting`);
      },
      onCycleEnd(cycle, qaResult) {
        console.log(`[loop] ${ticket.ticket_id} | cycle ${cycle} → ${qaResult.status}`);
      },
    });

    const httpStatus = result.outcome === 'passed' ? 200
                     : result.outcome === 'escalated' ? 200
                     : 207;
    return res.status(httpStatus).json(result);
  } catch (err) {
    console.error(`[loop] orchestration error:`, err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/qa/status', requireApiKey, (_req, res) => {
  res.json({
    status: 'ok',
    cache:   cache.stats(),
    retries: retryTracker.stats(),
    fixes:   fixRegistry.stats(),
    uptime_s: Math.floor(process.uptime()),
  });
});

// ── Project Memory ───────────────────────────────────────────────────────────

app.get('/api/memory', requireApiKey, (_req, res) => {
  try {
    res.json(memory.get());
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.patch('/api/memory/decisions', requireApiKey, (req, res) => {
  try {
    const entry = memory.addDecision(req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

app.patch('/api/memory/constraints', requireApiKey, (req, res) => {
  try {
    const entry = memory.addConstraint(req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[qa-server] Listening on port ${PORT}`);
  if (!API_KEY) console.warn('[qa-server] WARNING: QA_API_KEY not set — auth disabled');
});

module.exports = app; // for tests
