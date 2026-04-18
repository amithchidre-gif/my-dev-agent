'use strict';

/**
 * response.js — Normalises the QA result into the canonical response shape
 */

/**
 * @param {{
 *   ticketId: string,
 *   stages: Record<string, object>,
 *   failures: Array<{ stage: string, error: string }>,
 *   evidenceFiles: string[],
 *   durationMs: number,
 * }} params
 * @returns {object}
 */
function buildResponse({ ticketId, stages, failures, evidenceFiles, durationMs }) {
  const hasFailure  = failures.length > 0;
  const hasSkipped  = Object.values(stages).some(s => s.status === 'skipped');

  const status      = hasFailure ? 'failed' : 'passed';
  const reassign_to = hasFailure ? 'qa-team' : null;

  // Human-readable summary
  const passed  = Object.values(stages).filter(s => s.status === 'passed').length;
  const failed  = Object.values(stages).filter(s => s.status === 'failed').length;
  const skipped = Object.values(stages).filter(s => s.status === 'skipped').length;
  const total   = Object.keys(stages).length;

  const summary = [
    `${total} stage(s) total — ${passed} passed, ${failed} failed, ${skipped} skipped.`,
    hasFailure
      ? `First failure in stage "${failures[0].stage}": ${failures[0].error}`
      : 'All requested test stages passed.',
  ].join(' ');

  return {
    ticket_id:   ticketId,
    status,
    stages,
    failures,
    evidence:    evidenceFiles.length > 0 ? evidenceFiles : null,
    duration_ms: durationMs,
    summary,
    reassign_to,
  };
}

module.exports = { buildResponse };
