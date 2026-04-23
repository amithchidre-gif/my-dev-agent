'use strict';

/**
 * retry-guard.js — Retry loop guard for QA → CTO escalation workflow
 *
 * Tracks per-ticket retry counts across cycles and provides deterministic
 * escalation logic when max retries are exceeded.
 *
 * Public API:
 *   shouldEscalate(retryCount, maxRetries) → boolean
 *   buildEscalationResponse(ticketId)      → strict escalation payload
 *   RetryTracker                           → in-memory persistence store
 */

const DEFAULT_MAX_RETRIES = 3;

// ── Pure helper ──────────────────────────────────────────────────────────────

/**
 * Deterministic check: should this ticket be escalated?
 *
 * @param {number} retryCount  — current retry count (after increment)
 * @param {number} maxRetries  — ceiling before escalation
 * @returns {boolean}
 */
function shouldEscalate(retryCount, maxRetries) {
  if (typeof retryCount !== 'number' || typeof maxRetries !== 'number') return false;
  if (maxRetries < 0) return false;           // nonsensical ceiling → never escalate
  return retryCount >= maxRetries;
}

// ── Escalation response builder ──────────────────────────────────────────────

/**
 * Strict escalation payload contract.
 * Returned when a ticket exceeds its retry budget.
 *
 * @param {string} ticketId
 * @returns {{
 *   ticket_id:    string,
 *   status:       'escalated',
 *   reason:       'max_retries_exceeded',
 *   reassign_to:  'CTO_Agent',
 * }}
 */
function buildEscalationResponse(ticketId) {
  return {
    ticket_id:   String(ticketId || 'unknown'),
    status:      'escalated',
    reason:      'max_retries_exceeded',
    reassign_to: 'CTO_Agent',
  };
}

// ── In-memory retry tracker (persists across cycles within one process) ──────

/**
 * Lightweight in-memory store that keeps retry_count per ticket.
 *
 * Typical usage inside the QA route:
 *   const count = tracker.increment(ticketId);
 *   if (shouldEscalate(count, maxRetries)) { … }
 */
class RetryTracker {
  constructor() {
    /** @type {Map<string, { retry_count: number, max_retries: number }>} */
    this._tickets = new Map();
  }

  /**
   * Increment retry_count for a ticket. Creates the entry if it doesn't exist.
   * Accepts an optional explicit retry_count (from the request body) to
   * seed the tracker on first encounter.
   *
   * @param {string} ticketId
   * @param {{ retry_count?: number, max_retries?: number }} [seed]
   * @returns {number} the new retry_count after increment
   */
  increment(ticketId, seed = {}) {
    const existing = this._tickets.get(ticketId);

    if (existing) {
      existing.retry_count += 1;
      // Allow caller to tighten max_retries mid-flight
      if (typeof seed.max_retries === 'number') {
        existing.max_retries = seed.max_retries;
      }
      this._tickets.set(ticketId, existing);
      return existing.retry_count;
    }

    // First time seeing this ticket — seed from request
    const entry = {
      retry_count: (typeof seed.retry_count === 'number' ? seed.retry_count : 0) + 1,
      max_retries: typeof seed.max_retries === 'number' ? seed.max_retries : DEFAULT_MAX_RETRIES,
    };
    this._tickets.set(ticketId, entry);
    return entry.retry_count;
  }

  /**
   * Get the current state for a ticket without mutating it.
   * @param {string} ticketId
   * @returns {{ retry_count: number, max_retries: number } | null}
   */
  get(ticketId) {
    return this._tickets.get(ticketId) || null;
  }

  /**
   * Get max_retries for a ticket (falls back to DEFAULT_MAX_RETRIES).
   * @param {string} ticketId
   * @returns {number}
   */
  getMaxRetries(ticketId) {
    const entry = this._tickets.get(ticketId);
    return entry ? entry.max_retries : DEFAULT_MAX_RETRIES;
  }

  /** Reset a single ticket (e.g. after a successful run). */
  reset(ticketId) {
    this._tickets.delete(ticketId);
  }

  /** Full stats snapshot. */
  stats() {
    const entries = {};
    for (const [id, data] of this._tickets) {
      entries[id] = { ...data };
    }
    return { tracked: this._tickets.size, entries };
  }
}

module.exports = {
  shouldEscalate,
  buildEscalationResponse,
  RetryTracker,
  DEFAULT_MAX_RETRIES,
};
