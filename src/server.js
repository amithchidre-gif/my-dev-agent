import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();
const LOGS_DIR = path.join(ROOT, 'logs');
const WORKSPACE_DIR = path.join(ROOT, 'workspace');
const CLI_TIMEOUT_MS = 60_000;

app.use(express.json());

// ── Helpers ──────────────────────────────────────────────────────────────────

function ensureDirs() {
  [LOGS_DIR, WORKSPACE_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function logRequest(jobId, task, context, status, message = '') {
  const entry = [
    new Date().toISOString(),
    `jobId=${jobId}`,
    `status=${status}`,
    `task=${task}`,
    `context=${JSON.stringify(context)}`,
    message ? `message=${message}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  fs.appendFileSync(path.join(LOGS_DIR, 'tasks.log'), entry + '\n');
}

function saveTaskFile(jobId, task, context) {
  const file = path.join(WORKSPACE_DIR, `${jobId}.task.json`);
  fs.writeFileSync(file, JSON.stringify({ jobId, task, context, createdAt: new Date().toISOString() }, null, 2));
  return file;
}

function saveOutputFile(jobId, content) {
  const file = path.join(WORKSPACE_DIR, `${jobId}.output.json`);
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return file;
}

/**
 * Run GitHub Copilot CLI in non-interactive mode.
 * Command: copilot -p "<task>" --allow-all-tools --output-format json
 * Returns parsed JSON output from the CLI.
 */
function runCopilotCLI(task) {
  return new Promise((resolve, reject) => {
    const escaped = task.replace(/"/g, '\\"');
    const cmd = `copilot -p "${escaped}" --allow-all-tools --output-format json`;

    exec(cmd, { timeout: CLI_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        const reason = err.killed ? 'CLI timed out after 60s' : (stderr.trim() || err.message);
        return reject(new Error(reason));
      }

      // Attempt to parse JSON output; fall back to raw string
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });
  });
}

// ── Route ─────────────────────────────────────────────────────────────────────

app.post('/api/create-job', async (req, res) => {
  ensureDirs();

  const { task, context = {} } = req.body ?? {};

  if (!task || typeof task !== 'string') {
    return res.status(400).json({
      status: 'error',
      message: '`task` is required and must be a non-empty string.',
    });
  }

  const jobId = `job_${Date.now()}`;
  console.log(`[${jobId}] Received task: ${task}`);

  // 1. Save task file
  saveTaskFile(jobId, task, context);

  // 2. Log the incoming request
  logRequest(jobId, task, context, 'received');

  // 3. Call Copilot CLI
  try {
    const cliOutput = await runCopilotCLI(task);

    // 4. Store output in /workspace
    const outputFile = saveOutputFile(jobId, cliOutput);
    console.log(`[${jobId}] Output stored → ${outputFile}`);

    logRequest(jobId, task, context, 'completed');

    return res.json({
      status: 'completed',
      jobId,
      output: cliOutput,
    });
  } catch (err) {
    console.error(`[${jobId}] CLI error: ${err.message}`);

    // Store error output for traceability
    saveOutputFile(jobId, { error: err.message });
    logRequest(jobId, task, context, 'error', err.message);

    return res.status(500).json({
      status: 'error',
      jobId,
      message: err.message,
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
