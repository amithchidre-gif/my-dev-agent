'use strict';

/**
 * feedback-loop.js — Dev ↔ QA orchestration loop
 *
 * Drives the cycle:
 *   1. Dev submits code  → QA runs tests
 *   2. QA failure        → CTO creates fix ticket → reassign to Dev
 *   3. Dev fixes & resubmits → QA re-runs
 *   4. Repeat until pass — OR hit max_cycles → escalate to CTO
 *
 * Infinite-loop prevention:
 *   - Hard ceiling via max_cycles (default 5)
 *   - Per-cycle timeout
 *   - Duplicate-failure detection (same fingerprint = no progress → break)
 *
 * Public API:
 *   runFeedbackLoop(ticket, opts)   → Promise<LoopResult>
 *   LoopResult                      — final status + audit trail
 *
 * The orchestrator is agent-function-agnostic: it accepts `devFn` and `qaFn`
 * callbacks so callers can wire in real agents, mocks, or HTTP calls.
 */

const { generateFixTicket, FixTicketRegistry } = require('./cto-agent');
const { shouldEscalate }                       = require('./retry-guard');

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CYCLES    = 5;
const DEFAULT_CYCLE_TIMEOUT = 60_000;   // ms per cycle

// ── Loop result value object ─────────────────────────────────────────────────

class LoopResult {
  /**
   * @param {'passed'|'failed'|'escalated'} outcome
   * @param {object[]}  cycles       — per-cycle audit entries
   * @param {object|null} fixTicket  — last fix ticket created (if any)
   * @param {number}    totalMs      — wall-clock duration of entire loop
   */
  constructor(outcome, cycles, fixTicket, totalMs) {
    this.outcome     = outcome;
    this.total_cycles = cycles.length;
    this.cycles      = cycles;
    this.fix_ticket  = fixTicket;
    this.duration_ms = totalMs;
  }

  toJSON() {
    return {
      outcome:      this.outcome,
      total_cycles: this.total_cycles,
      cycles:       this.cycles,
      fix_ticket:   this.fix_ticket,
      duration_ms:  this.duration_ms,
    };
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Runs the Dev ↔ QA feedback loop until tests pass or the ceiling is hit.
 *
 * @param {{
 *   ticket_id:          string,
 *   test_strategy:      string[],
 *   definition_of_done?: object,
 *   workspace?:         string,
 *   [key: string]:      any,
 * }} ticket
 *   — the original ticket (never mutated)
 *
 * @param {{
 *   devFn:         (fixTicket: object) => Promise<{ status: string }>,
 *   qaFn:          (ticket: object)    => Promise<object>,
 *   maxCycles?:    number,
 *   cycleTimeout?: number,
 *   registry?:     FixTicketRegistry,
 *   onCycleStart?: (cycle: number) => void,
 *   onCycleEnd?:   (cycle: number, qaResult: object) => void,
 * }} opts
 *
 * @returns {Promise<LoopResult>}
 */
async function runFeedbackLoop(ticket, opts) {
  // ── Validate ───────────────────────────────────────────────────────────
  if (!ticket || !ticket.ticket_id) {
    throw new Error('runFeedbackLoop: ticket with ticket_id is required.');
  }
  if (typeof opts.qaFn !== 'function') {
    throw new Error('runFeedbackLoop: opts.qaFn callback is required.');
  }
  if (typeof opts.devFn !== 'function') {
    throw new Error('runFeedbackLoop: opts.devFn callback is required.');
  }

  const maxCycles    = opts.maxCycles    ?? DEFAULT_MAX_CYCLES;
  const cycleTimeout = opts.cycleTimeout ?? DEFAULT_CYCLE_TIMEOUT;
  const registry     = opts.registry     || new FixTicketRegistry();
  const onCycleStart = opts.onCycleStart || (() => {});
  const onCycleEnd   = opts.onCycleEnd   || (() => {});

  const loopStart      = Date.now();
  const cycles         = [];
  let   lastFixTicket  = null;
  let   lastFingerprint = null;

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    const cycleStart = Date.now();
    onCycleStart(cycle);

    // ── Step 1: Run QA ─────────────────────────────────────────────────
    let qaResult;
    try {
      qaResult = await _withTimeout(opts.qaFn(ticket), cycleTimeout,
        `QA timed out on cycle ${cycle} after ${cycleTimeout}ms`);
    } catch (err) {
      cycles.push(_cycleEntry(cycle, 'error', null, null, err.message, cycleStart));
      onCycleEnd(cycle, { status: 'error', error: err.message });
      // Treat timeout/crash as a failure — continue to next cycle
      continue;
    }

    const cycleEntry = _cycleEntry(cycle, qaResult.status, qaResult, null, null, cycleStart);

    // ── Step 2: QA passed → done ───────────────────────────────────────
    if (qaResult.status === 'passed') {
      cycles.push(cycleEntry);
      onCycleEnd(cycle, qaResult);
      return new LoopResult('passed', cycles, lastFixTicket, Date.now() - loopStart);
    }

    // ── Step 3: QA failed → check for no-progress ─────────────────────
    const fingerprint = _qaFingerprint(qaResult);
    if (fingerprint && fingerprint === lastFingerprint) {
      // Same failure twice in a row = no progress → escalate early
      cycleEntry.no_progress = true;
      cycles.push(cycleEntry);
      onCycleEnd(cycle, qaResult);
      return new LoopResult('escalated', cycles, lastFixTicket, Date.now() - loopStart);
    }
    lastFingerprint = fingerprint;

    // ── Step 4: CTO creates fix ticket ─────────────────────────────────
    const fixTicket = generateFixTicket(
      { ticket_id: ticket.ticket_id, definition_of_done: ticket.definition_of_done },
      qaResult,
      { registry }
    );
    if (fixTicket) lastFixTicket = fixTicket;
    cycleEntry.fix_ticket = fixTicket ? fixTicket.ticket_id : null;
    cycles.push(cycleEntry);
    onCycleEnd(cycle, qaResult);

    // ── Step 5: Max-cycles guard ───────────────────────────────────────
    if (shouldEscalate(cycle, maxCycles)) {
      return new LoopResult('escalated', cycles, lastFixTicket, Date.now() - loopStart);
    }

    // ── Step 6: Dev fixes ──────────────────────────────────────────────
    try {
      await _withTimeout(
        opts.devFn(fixTicket || { ticket_id: ticket.ticket_id, description: 'Fix required' }),
        cycleTimeout,
        `Dev timed out on cycle ${cycle} after ${cycleTimeout}ms`
      );
    } catch (err) {
      // Dev failure is non-fatal — next QA cycle will catch it
      console.warn(`[loop] Dev step failed on cycle ${cycle}: ${err.message}`);
    }
  }

  // Exhausted all cycles without a pass
  return new LoopResult('escalated', cycles, lastFixTicket, Date.now() - loopStart);
}

// ── Internals ────────────────────────────────────────────────────────────────

/** Build an audit entry for one cycle. */
function _cycleEntry(cycle, status, qaResult, fixTicketId, error, startMs) {
  return {
    cycle,
    status,
    qa_result:   qaResult  || null,
    fix_ticket:  fixTicketId || null,
    error:       error     || null,
    no_progress: false,
    duration_ms: Date.now() - startMs,
  };
}

/** Fingerprint a QA failure for no-progress detection. */
function _qaFingerprint(qaResult) {
  if (!qaResult || qaResult.status !== 'failed') return null;
  const stage  = qaResult.failed_stage || '';
  const errors = (qaResult.failures || [])
    .map(f => `${f.test_name || ''}::${f.error || ''}`)
    .sort()
    .join('|');
  return `${stage}::${errors}`;
}

/** Race a promise against a timeout. */
function _withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then(val  => { clearTimeout(timer); resolve(val); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

module.exports = {
  runFeedbackLoop,
  LoopResult,
  DEFAULT_MAX_CYCLES,
  DEFAULT_CYCLE_TIMEOUT,
};
