'use strict';

/**
 * validate.js — Input validation for QA requests
 */

const VALID_STRATEGIES = ['unit', 'integration', 'e2e', 'ai_tests'];

/**
 * Validates the POST /api/qa/run request body.
 * @param {object} body
 * @returns {{ valid: boolean, errors: string[], body: object }}
 */
function validateQARequest(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object.'], body: {} };
  }

  // ticketId
  if (!body.ticketId || typeof body.ticketId !== 'string' || !body.ticketId.trim()) {
    errors.push('`ticketId` is required and must be a non-empty string.');
  }

  // test_strategy
  if (!Array.isArray(body.test_strategy)) {
    errors.push('`test_strategy` is required and must be a non-empty array.');
  } else if (body.test_strategy.length === 0) {
    errors.push('`test_strategy` array must contain at least one entry.');
  } else {
    const unknown = body.test_strategy.filter(s => !VALID_STRATEGIES.includes(s));
    if (unknown.length > 0) {
      errors.push(`Unknown test strategy value(s): ${unknown.join(', ')}. Allowed: ${VALID_STRATEGIES.join(', ')}.`);
    }
  }

  // optional: workspace path must be a string if provided
  if (body.workspace !== undefined && typeof body.workspace !== 'string') {
    errors.push('`workspace` must be a string path when provided.');
  }

  return {
    valid: errors.length === 0,
    errors,
    body: {
      ticketId:      (body.ticketId || '').trim(),
      test_strategy: Array.isArray(body.test_strategy) ? [...new Set(body.test_strategy)] : [],
      workspace:     typeof body.workspace === 'string' ? body.workspace : undefined,
    },
  };
}

module.exports = { validateQARequest, VALID_STRATEGIES };
