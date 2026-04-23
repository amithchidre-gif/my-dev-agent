'use strict';

/**
 * response.js — Canonical QA response builders
 *
 * Two public functions:
 *
 *   buildFailureResponse(ticketId, stage, failures, evidencePathMap)
 *     → Strict failure contract. ALWAYS returns the exact shape required.
 *
 *   buildResponse({ ticketId, stages, failures, stageEvidenceMap, durationMs })
 *     → Full response. Delegates to buildFailureResponse when tests failed.
 */

// ── Strict failure contract ──────────────────────────────────────────────────

/**
 * Builds the strict failure payload contract. Every field is always present.
 * No variation in field names or structure is permitted.
 *
 * @param {string}   ticketId        — ticket identifier
 * @param {string}   stage           — name of the first failed stage
 * @param {Array<{
 *   test_name?:     string,
 *   stage?:         string,   // accepted alias for test_name
 *   error?:         string,
 *   evidence_path?: string,
 * }>} failures                      — raw or pre-normalised failure list
 * @param {string|Record<string,string>} [evidencePathMap]
 *   — fallback evidence path (string) OR map of stage → evidence path (object)
 *
 * @returns {{
 *   ticket_id:    string,
 *   status:       'failed',
 *   failed_stage: string,
 *   failures:     Array<{ test_name: string, error: string, evidence_path: string }>,
 *   reassign_to:  'Dev_Agent',
 * }}
 */
function buildFailureResponse(ticketId, stage, failures, evidencePathMap) {
  const resolveEvidence = (stageName) => {
    if (!evidencePathMap) return '';
    if (typeof evidencePathMap === 'string') return evidencePathMap;
    if (typeof evidencePathMap === 'object') return evidencePathMap[stageName] || evidencePathMap[stage] || '';
    return '';
  };

  // Normalise each failure into the exact required shape
  const normalised = (Array.isArray(failures) && failures.length > 0 ? failures : [{}])
    .map(f => ({
      test_name:     String(f.test_name || f.stage || f.name || stage || 'unknown'),
      error:         String(f.error || f.message || 'Test stage failed with no error details.'),
      evidence_path: String(f.evidence_path || resolveEvidence(f.stage || f.test_name || stage)),
    }));

  return {
    ticket_id:    String(ticketId   || 'unknown'),
    status:       'failed',
    failed_stage: String(stage      || normalised[0].test_name),
    failures:     normalised,
    reassign_to:  'Dev_Agent',
  };
}

// ── Full response (pass + fail) ──────────────────────────────────────────────

/**
 * @param {{
 *   ticketId:        string,
 *   stages:          Record<string, object>,
 *   failures:        Array<{ stage: string, error: string }>,
 *   stageEvidenceMap: Record<string, string>,  — stage → first evidence file path
 *   durationMs:      number,
 * }} params
 * @returns {object}
 */
function buildResponse({ ticketId, stages, failures, stageEvidenceMap = {}, durationMs }) {
  const hasFailure = failures.length > 0;

  // ── Failure path — strict contract only ──────────────────────────────────
  if (hasFailure) {
    const firstFailedStage = failures[0].stage;
    return buildFailureResponse(ticketId, firstFailedStage, failures, stageEvidenceMap);
  }

  // ── Success path ─────────────────────────────────────────────────────────
  const passed  = Object.values(stages).filter(s => s.status === 'passed').length;
  const skipped = Object.values(stages).filter(s => s.status === 'skipped').length;
  const total   = Object.keys(stages).length;

  const allEvidence = Object.values(stageEvidenceMap).filter(Boolean);

  return {
    ticket_id:   String(ticketId),
    status:      'passed',
    stages,
    evidence:    allEvidence.length > 0 ? allEvidence : null,
    duration_ms: durationMs,
    summary:     `${total} stage(s) total — ${passed} passed, ${skipped} skipped. All requested test stages passed.`,
    reassign_to: null,
  };
}

const { buildEscalationResponse } = require('./retry-guard');

module.exports = { buildResponse, buildFailureResponse, buildEscalationResponse };
