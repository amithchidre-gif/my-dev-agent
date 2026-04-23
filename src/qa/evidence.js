'use strict';

/**
 * evidence.js — Simple evidence storage for QA agent
 * Saves logs and screenshots to /evidence/{ticketId}/
 */

const fs   = require('fs');
const path = require('path');

const EVIDENCE_ROOT = process.env.QA_EVIDENCE_DIR
  || path.join(process.cwd(), 'evidence');

/**
 * Saves evidence for a test stage.
 *
 * @param {string} ticketId
 * @param {string} stage
 * @param {object} result - StageResult with stdout, stderr, status, etc.
 * @returns {object} { dir: string, files: string[] } - evidence directory and saved file paths
 */
function saveEvidence(ticketId, stage, result) {
  const dir = path.join(EVIDENCE_ROOT, sanitize(ticketId));
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const files = [];

  // Save stdout log
  if (result.stdout && result.stdout.trim()) {
    const file = path.join(dir, `${stage}-${timestamp}.stdout.log`);
    fs.writeFileSync(file, result.stdout);
    files.push(file);
  }

  // Save stderr log
  if (result.stderr && result.stderr.trim()) {
    const file = path.join(dir, `${stage}-${timestamp}.stderr.log`);
    fs.writeFileSync(file, result.stderr);
    files.push(file);
  }

  // Save error log if present
  if (result.error) {
    const file = path.join(dir, `${stage}-${timestamp}.error.log`);
    fs.writeFileSync(file, result.error);
    files.push(file);
  }

  // Save screenshots for e2e tests
  if (stage === 'e2e') {
    const screenshotFiles = copyScreenshots(dir, timestamp);
    files.push(...screenshotFiles);
  }

  return { dir, files };
}

/**
 * Copy screenshots from test-results/ to evidence dir.
 * @param {string} destDir
 * @param {string} timestamp
 * @returns {string[]} copied file paths
 */
function copyScreenshots(destDir, timestamp) {
  const testResultsDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(testResultsDir)) return [];

  const files = [];
  const entries = fs.readdirSync(testResultsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name)) {
      const src = path.join(testResultsDir, entry.name);
      const dest = path.join(destDir, `screenshot-${timestamp}-${entry.name}`);
      try {
        fs.copyFileSync(src, dest);
        files.push(dest);
      } catch (err) {
        // Ignore copy errors
      }
    }
  }

  return files;
}

/** Sanitize ticketId for filesystem safety */
function sanitize(str) {
  return str.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

module.exports = { saveEvidence, EVIDENCE_ROOT };
