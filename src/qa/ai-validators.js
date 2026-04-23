'use strict';

/**
 * ai-validators.js — Pluggable AI response validators
 *
 * Each validator receives a test case and returns:
 *   { score: number (0–1), passed: boolean, details: string }
 *
 * To add a new validator, export a function with the same signature
 * and register it in VALIDATORS.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Tokenise a string into lowercase words (letters, digits, hyphens). */
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().match(/[\w-]+/g) || [];
}

/** Jaccard similarity of two token sets. */
function jaccard(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter(t => b.has(t)).length;
  const union        = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Validators ───────────────────────────────────────────────────────────────

/**
 * Relevance — does the response address the prompt?
 *
 * Scores keyword overlap between prompt and response.
 * Optionally checks that `expectedKeywords` all appear in the response.
 *
 * @param {{ prompt: string, response: string, expectedKeywords?: string[] }} tc
 * @returns {{ score: number, passed: boolean, details: string }}
 */
function validateRelevance(tc) {
  const promptTokens   = tokenize(tc.prompt);
  const responseTokens = tokenize(tc.response);

  // Keyword-overlap score (Jaccard)
  const overlapScore = jaccard(promptTokens, responseTokens);

  // Expected-keyword hit rate (when provided)
  let keywordScore = 1;
  let missingKeywords = [];
  if (Array.isArray(tc.expectedKeywords) && tc.expectedKeywords.length > 0) {
    const respLower = (tc.response || '').toLowerCase();
    missingKeywords = tc.expectedKeywords.filter(k => !respLower.includes(k.toLowerCase()));
    keywordScore = 1 - missingKeywords.length / tc.expectedKeywords.length;
  }

  // Weighted blend: 40 % overlap + 60 % keyword hit
  const score = Array.isArray(tc.expectedKeywords) && tc.expectedKeywords.length > 0
    ? 0.4 * overlapScore + 0.6 * keywordScore
    : overlapScore;

  const passed = score >= 0.3; // configurable threshold

  const details = [
    `overlap=${overlapScore.toFixed(2)}`,
    tc.expectedKeywords?.length ? `keyword_hit=${keywordScore.toFixed(2)}` : null,
    missingKeywords.length ? `missing=[${missingKeywords.join(', ')}]` : null,
  ].filter(Boolean).join(', ');

  return { score: Math.round(score * 100) / 100, passed, details };
}

/**
 * Consistency — are multiple responses to the same prompt self-consistent?
 *
 * Accepts an array of responses and computes pairwise similarity.
 * A single response automatically passes with score 1.
 *
 * @param {{ prompt: string, responses: string[] }} tc
 * @returns {{ score: number, passed: boolean, details: string }}
 */
function validateConsistency(tc) {
  const responses = tc.responses || [tc.response];

  if (!responses || responses.length <= 1) {
    return { score: 1, passed: true, details: 'single response — consistency not applicable' };
  }

  // Pairwise Jaccard between all response pairs
  let totalSim = 0;
  let pairs    = 0;
  for (let i = 0; i < responses.length; i++) {
    for (let j = i + 1; j < responses.length; j++) {
      totalSim += jaccard(tokenize(responses[i]), tokenize(responses[j]));
      pairs++;
    }
  }

  const score  = pairs > 0 ? totalSim / pairs : 1;
  const passed = score >= 0.4; // configurable threshold

  return {
    score:   Math.round(score * 100) / 100,
    passed,
    details: `pairs=${pairs}, avg_similarity=${score.toFixed(2)}`,
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Extensible map of validator name → function.
 * Add new validators here and they will be picked up automatically.
 */
const VALIDATORS = {
  relevance:   validateRelevance,
  consistency: validateConsistency,
};

module.exports = { VALIDATORS, validateRelevance, validateConsistency, tokenize, jaccard };
