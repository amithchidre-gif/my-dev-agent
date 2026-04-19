'use strict';

/**
 * cto-agent.js — CTO Agent: converts QA failures into fix tickets
 *
 * Public API:
 *   generateFixTicket(originalTicket, qaFailure) → fix ticket object
 *   FixTicketRegistry — duplicate-prevention store
 *
 * Contract:
 *   - NEVER modifies the original ticket
 *   - Produces a NEW fix ticket with a deterministic ID: {parent}-FIX-{n}
 *   - Preserves the original Definition of Done
 *   - Extracts failure context into the description
 *   - Prevents duplicate fix tickets for the same failure fingerprint
 */

// ── Fix-ticket generator ─────────────────────────────────────────────────────

/**
 * Generates a new fix ticket from a QA failure response.
 *
 * @param {{
 *   ticket_id:          string,
 *   definition_of_done?: object,
 *   [key: string]:      any,
 * }} originalTicket
 *   — the original ticket that was tested (read-only, never mutated)
 *
 * @param {{
 *   ticket_id:    string,
 *   status:       'failed',
 *   failed_stage: string,
 *   failures:     Array<{ test_name: string, error: string, evidence_path: string }>,
 *   reassign_to?: string,
 * }} qaFailure
 *   — the strict failure payload from the QA agent
 *
 * @param {{ registry?: FixTicketRegistry }} [opts]
 *   — optional registry for duplicate prevention + sequence tracking
 *
 * @returns {{
 *   ticket_id:          string,
 *   parent_ticket:      string,
 *   priority:           'high',
 *   description:        string,
 *   context:            { failed_stage: string, evidence_path: string },
 *   definition_of_done: object,
 * } | null}
 *   Returns null if a fix ticket already exists for this exact failure.
 */
function generateFixTicket(originalTicket, qaFailure, opts = {}) {
  // ── Validate inputs ────────────────────────────────────────────────────
  if (!originalTicket || typeof originalTicket !== 'object') {
    throw new Error('generateFixTicket: originalTicket is required and must be an object.');
  }
  if (!qaFailure || qaFailure.status !== 'failed') {
    throw new Error('generateFixTicket: qaFailure must be a failed QA response (status === "failed").');
  }

  const parentId = String(originalTicket.ticket_id || qaFailure.ticket_id || 'unknown');

  // ── Duplicate prevention ───────────────────────────────────────────────
  const registry    = opts.registry || null;
  const fingerprint = _buildFingerprint(parentId, qaFailure);

  if (registry && registry.has(fingerprint)) {
    return null; // already have a fix ticket for this exact failure
  }

  // ── Sequence number ────────────────────────────────────────────────────
  const fixNumber = registry
    ? registry.nextSequence(parentId)
    : 1;

  const fixTicketId = `${parentId}-FIX-${fixNumber}`;

  // ── Build description from failure details ─────────────────────────────
  const failedStage = String(qaFailure.failed_stage || 'unknown');
  const failures    = Array.isArray(qaFailure.failures) ? qaFailure.failures : [];

  const failureLines = failures.map(
    (f, i) => `  ${i + 1}. [${f.test_name || 'unknown'}] ${f.error || 'no details'}`
  );

  const description = [
    `Fix required for failed QA on ticket ${parentId}.`,
    `Stage: ${failedStage}`,
    `Failure(s):`,
    ...failureLines,
  ].join('\n');

  // ── Evidence path — first non-empty path from QA failures ──────────────
  const evidencePath = failures
    .map(f => f.evidence_path)
    .find(p => p && p.length > 0) || '';

  // ── Preserve Definition of Done from the original ticket ───────────────
  const definitionOfDone = originalTicket.definition_of_done
    && typeof originalTicket.definition_of_done === 'object'
    ? { ...originalTicket.definition_of_done }
    : {};

  // ── Assemble fix ticket (new object — original is untouched) ───────────
  const fixTicket = {
    ticket_id:          fixTicketId,
    parent_ticket:      parentId,
    priority:           'high',
    description,
    context: {
      failed_stage:  failedStage,
      evidence_path: evidencePath,
    },
    definition_of_done: definitionOfDone,
  };

  // ── Register to prevent future duplicates ──────────────────────────────
  if (registry) {
    registry.register(fingerprint, fixTicketId);
  }

  return fixTicket;
}

// ── Fingerprint (deterministic, based on failure content) ────────────────────

/**
 * Builds a collision-resistant string from the failure data.
 * Two QA runs with the same parent + stage + errors = same fingerprint.
 *
 * @param {string} parentId
 * @param {object} qaFailure
 * @returns {string}
 */
function _buildFingerprint(parentId, qaFailure) {
  const stage  = qaFailure.failed_stage || '';
  const errors = (qaFailure.failures || [])
    .map(f => `${f.test_name || ''}::${f.error || ''}`)
    .sort()
    .join('|');
  return `${parentId}::${stage}::${errors}`;
}

// ── Duplicate-prevention registry ────────────────────────────────────────────

/**
 * In-memory registry that tracks:
 *   1. Which failure fingerprints already have fix tickets
 *   2. Per-parent sequence counters for FIX-{n} numbering
 */
class FixTicketRegistry {
  constructor() {
    /** @type {Map<string, string>} fingerprint → fix ticket ID */
    this._fingerprints = new Map();
    /** @type {Map<string, number>} parent ticket ID → last FIX sequence */
    this._sequences = new Map();
  }

  /** Check if a fingerprint has already been registered. */
  has(fingerprint) {
    return this._fingerprints.has(fingerprint);
  }

  /** Register a fingerprint → fix ticket mapping. */
  register(fingerprint, fixTicketId) {
    this._fingerprints.set(fingerprint, fixTicketId);
  }

  /** Get the fix ticket ID for a fingerprint, or null. */
  lookup(fingerprint) {
    return this._fingerprints.get(fingerprint) || null;
  }

  /**
   * Return the next sequence number for a parent ticket and advance the counter.
   * First call for a parent returns 1.
   * @param {string} parentId
   * @returns {number}
   */
  nextSequence(parentId) {
    const current = this._sequences.get(parentId) || 0;
    const next    = current + 1;
    this._sequences.set(parentId, next);
    return next;
  }

  /** Peek at the current sequence without advancing. */
  currentSequence(parentId) {
    return this._sequences.get(parentId) || 0;
  }

  /** Full snapshot for observability. */
  stats() {
    return {
      tracked_fingerprints: this._fingerprints.size,
      tracked_parents:      this._sequences.size,
    };
  }
}

module.exports = {
  generateFixTicket,
  FixTicketRegistry,
  _buildFingerprint, // exported for testing
};
