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

  // optional: retry_count / max_retries (retry loop guard)
  if (body.retry_count !== undefined && (typeof body.retry_count !== 'number' || body.retry_count < 0)) {
    errors.push('`retry_count` must be a non-negative number when provided.');
  }
  if (body.max_retries !== undefined && (typeof body.max_retries !== 'number' || body.max_retries < 1)) {
    errors.push('`max_retries` must be a positive number when provided.');
  }

  // optional: ai_test_input must be an array of test case objects if provided
  if (body.ai_test_input !== undefined) {
    if (!Array.isArray(body.ai_test_input)) {
      errors.push('`ai_test_input` must be an array of test case objects when provided.');
    } else {
      for (let i = 0; i < body.ai_test_input.length; i++) {
        const tc = body.ai_test_input[i];
        if (!tc || typeof tc !== 'object') {
          errors.push(`ai_test_input[${i}] must be an object.`);
        } else if (!tc.prompt || typeof tc.prompt !== 'string') {
          errors.push(`ai_test_input[${i}].prompt is required and must be a string.`);
        } else if (!tc.response && !tc.responses) {
          errors.push(`ai_test_input[${i}] must have a "response" or "responses" field.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    body: {
      ticketId:      (body.ticketId || '').trim(),
      test_strategy: Array.isArray(body.test_strategy) ? [...new Set(body.test_strategy)] : [],
      workspace:     typeof body.workspace === 'string' ? body.workspace : undefined,
      ai_test_input: Array.isArray(body.ai_test_input) ? body.ai_test_input : undefined,
      retry_count:   typeof body.retry_count === 'number' ? body.retry_count : undefined,
      max_retries:   typeof body.max_retries === 'number' ? body.max_retries : undefined,
    },
  };
}

module.exports = { validateQARequest, VALID_STRATEGIES };
