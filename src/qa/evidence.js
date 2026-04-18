'use strict';

/**
 * evidence.js — Save test logs and screenshots to disk
 * Location: /evidence/{ticketId}/{stage}/
 */

const fs   = require('fs');
const path = require('path');

const EVIDENCE_ROOT = process.env.QA_EVIDENCE_DIR
  || path.join(process.cwd(), 'evidence');

/**
 * Saves stage logs to the evidence directory.
 *
 * @param {string} ticketId
 * @param {string} stage
 * @param {{ stdout?: string, stderr?: string, status: string, error?: string }} result
 * @returns {string} absolute path to the evidence directory for this ticket/stage
 */
async function saveEvidence(ticketId, stage, result) {
  const dir = path.join(EVIDENCE_ROOT, sanitize(ticketId), stage);
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // stdout log
  if (result.stdout) {
    fs.writeFileSync(path.join(dir, `${timestamp}.stdout.log`), result.stdout);
  }

  // stderr log
  if (result.stderr) {
    fs.writeFileSync(path.join(dir, `${timestamp}.stderr.log`), result.stderr);
  }

  // structured summary
  const summary = {
    ticketId,
    stage,
    status:      result.status,
    error:       result.error  || null,
    duration_ms: result.duration_ms || null,
    attempt:     result.attempt || 1,
    savedAt:     new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(dir, `${timestamp}.summary.json`),
    JSON.stringify(summary, null, 2)
  );

  // Playwright screenshots: copy from default playwright output if present
  if (stage === 'e2e') {
    copyPlaywrightScreenshots(ticketId, dir);
  }

  return path.join(EVIDENCE_ROOT, sanitize(ticketId));
}

/**
 * Copies Playwright screenshots to evidence dir if they exist.
 * Playwright writes to `test-results/` by default.
 */
function copyPlaywrightScreenshots(ticketId, destDir) {
  const playwrightOut = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(playwrightOut)) return;

  const screenshots = findFiles(playwrightOut, /\.(png|jpg|jpeg|webp)$/i);
  for (const src of screenshots) {
    const name = path.basename(src);
    try {
      fs.copyFileSync(src, path.join(destDir, name));
    } catch (_) {}
  }
}

function findFiles(dir, pattern) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, pattern));
    else if (pattern.test(entry.name)) results.push(full);
  }
  return results;
}

/** Strip path-traversal characters from ticketId */
function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

module.exports = { saveEvidence, EVIDENCE_ROOT };
