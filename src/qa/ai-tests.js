'use strict';

/**
 * ai-tests.js — AI quality test runner
 *
 * Executed as a child process by the QA engine for the `ai_tests` stage.
 *
 * Input
 *   - Env var AI_TEST_INPUT → path to a JSON file with test cases.
 *   - If missing, runs built-in smoke checks instead.
 *
 * Input JSON shape:
 *   { "cases": [
 *       { "prompt": "...", "response": "...", "expectedKeywords": ["kw1"],
 *         "responses": ["r1","r2"] }
 *   ]}
 *
 * Output (stdout as JSON):
 *   { "score": 0.85, "passed": true, "results": [...], "summary": "..." }
 *
 * Exit code 0 = pass, 1 = fail.
 */

const path = require('path');
const fs   = require('fs');

const { VALIDATORS } = require('./ai-validators');

// ── Load input ───────────────────────────────────────────────────────────────

function loadTestCases() {
  const inputPath = process.env.AI_TEST_INPUT;

  if (inputPath && fs.existsSync(inputPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
      if (Array.isArray(raw.cases) && raw.cases.length > 0) return raw.cases;
    } catch (e) {
      console.error(`[ai-tests] Failed to parse ${inputPath}: ${e.message}`);
    }
  }

  // ── Built-in smoke cases (always run when no input provided) ─────────
  return [
    {
      prompt:   'What does this project do?',
      response: 'AI Autonomous Dev System using Node.js Express and Docker',
      expectedKeywords: ['node', 'express'],
    },
    {
      prompt:    'Summarise the test strategy for this project',
      response:  'Unit tests with Vitest, integration tests with Supertest, E2E tests with Playwright',
      expectedKeywords: ['vitest', 'playwright'],
      responses: [
        'Unit tests with Vitest, integration tests with Supertest, E2E tests with Playwright',
        'Vitest for unit testing, Supertest for integration, Playwright for end-to-end tests',
      ],
    },
  ];
}

// ── Run validators ───────────────────────────────────────────────────────────

function run() {
  const cases   = loadTestCases();
  const results = [];
  let   totalScore = 0;
  let   checks     = 0;
  let   failures   = 0;

  console.log(`\n[ai-tests] Running AI validation on ${cases.length} case(s)…\n`);

  for (let i = 0; i < cases.length; i++) {
    const tc       = cases[i];
    const caseId   = tc.id || `case-${i + 1}`;
    const caseRes  = { id: caseId, prompt: tc.prompt, validators: {} };

    for (const [name, fn] of Object.entries(VALIDATORS)) {
      // Skip validators that don't apply to this case
      if (name === 'consistency' && !tc.responses) continue;

      const result = fn(tc);
      caseRes.validators[name] = result;

      totalScore += result.score;
      checks++;
      if (!result.passed) failures++;

      const icon = result.passed ? '✓' : '✗';
      console.log(`  ${icon} [${caseId}] ${name}: score=${result.score} — ${result.details}`);
    }

    results.push(caseRes);
  }

  const avgScore = checks > 0 ? Math.round((totalScore / checks) * 100) / 100 : 0;
  const passed   = failures === 0 && avgScore >= 0.3;

  const summary = `${checks} check(s), ${checks - failures} passed, ${failures} failed. avg_score=${avgScore}`;

  console.log(`\n[ai-tests] ${summary}\n`);

  // Structured output (engine captures stdout)
  const output = { score: avgScore, passed, results, summary };
  console.log(JSON.stringify(output));

  // Optionally write to file
  if (process.env.AI_TEST_OUTPUT) {
    fs.writeFileSync(process.env.AI_TEST_OUTPUT, JSON.stringify(output, null, 2));
  }

  process.exit(passed ? 0 : 1);
}

run();
