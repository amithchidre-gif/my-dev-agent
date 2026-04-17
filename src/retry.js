/**
 * Intelligent retry engine.
 *
 * - Retries up to MAX_RETRIES times
 * - Feeds previous error context into the next attempt
 * - Tracks failed approaches so the caller can avoid repeating them
 * - Returns escalation JSON when all retries are exhausted
 */

const MAX_RETRIES = 3;

/**
 * @param {function} executeFn  - async (attempt) => result
 *   `attempt` is an object: { number, previousErrors, failedApproaches }
 *   Must return { success: true, data: ... } or throw / return { success: false, error, approach }
 *
 * @returns {object}
 *   On success: { success: true, data, attempts }
 *   On exhaustion: { success: false, escalation: { ... } }
 */
async function withRetry(executeFn) {
  const previousErrors = [];
  const failedApproaches = [];

  for (let i = 1; i <= MAX_RETRIES; i++) {
    const attempt = {
      number: i,
      previousErrors: [...previousErrors],
      failedApproaches: [...failedApproaches],
    };

    try {
      const result = await executeFn(attempt);

      if (result && result.success) {
        return { success: true, data: result.data, attempts: i };
      }

      // Explicit failure (no throw)
      const err = result.error || 'Unknown failure';
      const approach = result.approach || `attempt-${i}`;
      previousErrors.push({ attempt: i, error: err, approach });
      failedApproaches.push(approach);
      console.error(`[retry] Attempt ${i}/${MAX_RETRIES} failed (${approach}): ${err}`);
    } catch (err) {
      const message = err.message || String(err);
      const approach = err.approach || `attempt-${i}`;
      previousErrors.push({ attempt: i, error: message, approach });
      failedApproaches.push(approach);
      console.error(`[retry] Attempt ${i}/${MAX_RETRIES} threw (${approach}): ${message}`);
    }
  }

  // All retries exhausted → escalation
  return {
    success: false,
    escalation: {
      status: 'escalation_required',
      message: `All ${MAX_RETRIES} attempts failed. Manual intervention needed.`,
      attempts: previousErrors,
      failedApproaches,
      timestamp: new Date().toISOString(),
    },
  };
}

module.exports = { withRetry, MAX_RETRIES };
