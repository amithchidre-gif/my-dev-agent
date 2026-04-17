const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { createBranchAndPR } = require('./git');

// Enrich PATH so child processes can find gh and copilot
const GH_PATH   = 'C:\\Program Files\\GitHub CLI';
const COPILOT_BAT = process.env.COPILOT_PATH ||
  'c:\\Users\\amith\\AppData\\Roaming\\Code\\User\\globalStorage\\github.copilot-chat\\copilotCli\\copilot.bat';
process.env.PATH = `${GH_PATH};${process.env.PATH}`;

const app = express();
const PORT = process.env.PORT || 3002;

const ROOT      = path.join(__dirname, '..');
const LOGS_DIR  = path.join(ROOT, 'logs');
const WORKSPACE = path.join(ROOT, 'workspace');

if (!fs.existsSync(LOGS_DIR))  fs.mkdirSync(LOGS_DIR,  { recursive: true });
if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });

app.use(express.json());

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Copilot CLI with --output-format json returns a JSON envelope.
 * The actual code is embedded in markdown fenced blocks inside the
 * text fields of that JSON. This function handles both:
 *   - Raw JSON envelope from `copilot --output-format json`
 *   - Plain text / markdown (fallback)
 */
function extractCode(raw) {
  // 1. Try to parse as JSON envelope (Copilot --output-format json)
  let searchTarget = raw;
  try {
    const parsed = JSON.parse(raw);
    // The response field names vary across Copilot CLI versions;
    // try all common keys that contain the generated text
    const textContent = (
      parsed.response ||
      parsed.content  ||
      parsed.text     ||
      parsed.output   ||
      (Array.isArray(parsed.messages) &&
        parsed.messages
          .filter((m) => m.role === 'assistant')
          .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
          .join('\n')) ||
      JSON.stringify(parsed)  // last resort: search the whole stringified object
    );
    if (typeof textContent === 'string') searchTarget = textContent;
  } catch (_) {
    // Not JSON — treat raw string as-is
  }

  // 2. Match fenced code block (``` with or without language tag)
  const fenced = searchTarget.match(/```(?:python|javascript|js|py|bash|sh)?\n([\s\S]*?)```/);
  if (fenced) return { code: fenced[1].trim(), ext: guessExt(searchTarget) };

  // 3. Fallback: return the search target as-is (may be plain code)
  const trimmed = searchTarget.trim();
  if (trimmed) return { code: trimmed, ext: 'py' };

  return {
    code: `# Code generation produced no extractable output.\n# Raw snippet:\n# ${raw.slice(0, 300)}`,
    ext: 'py',
  };
}

function guessExt(text) {
  if (/```(?:javascript|js)/i.test(text)) return 'js';
  if (/```(?:bash|sh)/i.test(text))       return 'sh';
  return 'py';
}

function logEntry(jobId, ticketId, task, status, extra = {}) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    jobId, ticketId, task, status, ...extra,
  });
  fs.appendFileSync(path.join(LOGS_DIR, 'tasks.log'), entry + '\n');
}

// ── route ─────────────────────────────────────────────────────────────────────

app.post('/api/create-job', async (req, res) => {
  const { task, context = {}, ticketId } = req.body ?? {};
  const jobId = `job_${Date.now()}`;

  if (!task || typeof task !== 'string') {
    return res.status(400).json({ status: 'error', message: '`task` must be a non-empty string.' });
  }
  if (!ticketId || typeof ticketId !== 'string') {
    return res.status(400).json({ status: 'error', message: '`ticketId` must be a non-empty string.' });
  }

  console.log(`[${jobId}] Task: ${task} | Ticket: ${ticketId}`);
  logEntry(jobId, ticketId, task, 'received', { context });

  // ── 1. Call Copilot CLI ──────────────────────────────────────────────────
  let copilotRaw;
  try {
    const safeTask = task.replace(/"/g, '\\"');
    // Use full path to copilot.bat to avoid PATH issues in child process
    const cmd = `"${COPILOT_BAT}" -p "${safeTask}" --allow-all-tools --output-format json`;
    console.log(`[${jobId}] Running: ${cmd.slice(0, 120)}...`);
    const { stdout } = await execPromise(cmd, { timeout: 60_000, shell: true });
    copilotRaw = stdout;
    fs.writeFileSync(path.join(WORKSPACE, `${jobId}.output.json`), stdout);
    console.log(`[${jobId}] Copilot completed`);
    logEntry(jobId, ticketId, task, 'copilot-complete');
  } catch (err) {
    const reason = err.killed ? 'Copilot CLI timed out after 60s' : err.message;
    console.error(`[${jobId}] Copilot error: ${reason}`);
    logEntry(jobId, ticketId, task, 'copilot-error', { error: reason });
    return res.status(500).json({ status: 'error', jobId, message: reason });
  }

  // ── 2. Extract code → save to project ROOT (not workspace/) ─────────────
  const { code, ext } = extractCode(copilotRaw);
  const codeFileName = `${ticketId}_solution.${ext}`;
  const codeFilePath = path.join(ROOT, codeFileName);

  fs.writeFileSync(codeFilePath, code);
  console.log(`[${jobId}] Code saved → ${codeFilePath}`);
  logEntry(jobId, ticketId, task, 'code-saved', { codeFileName });

  // ── 3. Git: branch → add → commit → push → PR ───────────────────────────
  const gitResult = await createBranchAndPR({ ticketId, task, jobId, codeFileName, root: ROOT });

  if (!gitResult.success) {
    logEntry(jobId, ticketId, task, 'git-error', { error: gitResult.error });
    return res.status(207).json({
      status: 'partial',
      jobId,
      codeFile: codeFileName,
      gitError: gitResult.error,
    });
  }

  logEntry(jobId, ticketId, task, 'completed', { branch: gitResult.branch, prUrl: gitResult.prUrl });

  return res.json({
    status: 'completed',
    jobId,
    codeFile: codeFileName,
    branch: gitResult.branch,
    prUrl: gitResult.prUrl,
  });
});

// ── start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
