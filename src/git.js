const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// ── helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Auto-detect the default branch (master, main, or anything else).
 * Strategy:
 *   1. git symbolic-ref refs/remotes/origin/HEAD  (fast, works when fetch was run)
 *   2. git remote show origin | grep HEAD          (slower but reliable)
 *   3. Fallback: try master, then main
 */
async function detectDefaultBranch(root, jobId) {
  const run = (cmd) => execPromise(cmd, { cwd: root, timeout: 15_000 });

  // Strategy 1 – symbolic-ref
  try {
    const { stdout } = await run('git symbolic-ref refs/remotes/origin/HEAD');
    const branch = stdout.trim().replace('refs/remotes/origin/', '');
    if (branch) {
      console.log(`[${jobId}] Default branch detected (symbolic-ref): ${branch}`);
      return branch;
    }
  } catch (_) {}

  // Attempt to set the symbolic-ref automatically, then retry
  try {
    await run('git remote set-head origin --auto');
    const { stdout } = await run('git symbolic-ref refs/remotes/origin/HEAD');
    const branch = stdout.trim().replace('refs/remotes/origin/', '');
    if (branch) {
      console.log(`[${jobId}] Default branch detected (after set-head --auto): ${branch}`);
      return branch;
    }
  } catch (_) {}

  // Strategy 2 – git remote show origin
  try {
    const { stdout } = await run('git remote show origin');
    const match = stdout.match(/HEAD branch:\s*(\S+)/);
    if (match && match[1] && match[1] !== '(unknown)') {
      console.log(`[${jobId}] Default branch detected (remote show): ${match[1]}`);
      return match[1];
    }
  } catch (_) {}

  // Strategy 3 – probe local branches
  for (const candidate of ['master', 'main']) {
    try {
      const { stdout } = await run(`git branch --list ${candidate}`);
      if (stdout.trim()) {
        console.log(`[${jobId}] Default branch detected (local probe): ${candidate}`);
        return candidate;
      }
    } catch (_) {}
  }

  // Last resort
  console.warn(`[${jobId}] Could not detect default branch, falling back to 'master'`);
  return 'master';
}

/**
 * Ensure git user config exists so commits don't fail in CI/bare environments.
 */
async function ensureGitUser(root) {
  const run = (cmd) => execPromise(cmd, { cwd: root, timeout: 10_000 });
  try { await run('git config user.email'); } catch (_) {
    await run('git config user.email "agent@ai-coding-agent.local"');
  }
  try { await run('git config user.name'); } catch (_) {
    await run('git config user.name "AI Coding Agent"');
  }
}

// ── main export ───────────────────────────────────────────────────────────────

/**
 * Full Git flow:
 *   1. Detect default branch automatically
 *   2. Checkout default branch & pull latest
 *   3. Delete stale feature branch if it exists (local + remote)
 *   4. Create fresh feature branch
 *   5. git add <codeFileName>  (specific file only)
 *   6. git commit
 *   7. git push
 *   8. Wait 3 s for GitHub to register the branch
 *   9. gh pr create
 *  10. Return to default branch
 *
 * All exec calls use { cwd: root } — process.chdir() is never called.
 *
 * @param {object} opts
 * @param {string} opts.ticketId      - e.g. "AUTO-FIX"
 * @param {string} opts.task          - human-readable task description
 * @param {string} opts.jobId         - for console logging
 * @param {string} opts.codeFileName  - e.g. "AUTO-FIX_solution.py" (lives in opts.root)
 * @param {string} opts.root          - absolute path to the project root
 */
async function createBranchAndPR({ ticketId, task, jobId, codeFileName, root }) {
  const featureBranch = `feature/${ticketId}`;
  const commitMessage = `feat(${ticketId}): ${task.substring(0, 72)}`;
  const prTitle       = `feat(${ticketId}): ${task.substring(0, 72)}`;
  const prBody        = [
    `## Ticket: ${ticketId}`,
    '',
    '## Task',
    task,
    '',
    '## Changes',
    `- Added \`${codeFileName}\``,
    '',
    `## Job ID: ${jobId}`,
  ].join('\n');

  const run = (cmd) => execPromise(cmd, { cwd: root, timeout: 30_000 });

  try {
    await ensureGitUser(root);

    // ── 1. Detect default branch ───────────────────────────────────────────
    const defaultBranch = await detectDefaultBranch(root, jobId);

    // ── 2. Checkout default branch & pull ──────────────────────────────────
    try {
      await run(`git checkout ${defaultBranch}`);
      await run(`git pull origin ${defaultBranch} --ff-only`);
      console.log(`[${jobId}] On '${defaultBranch}', pulled latest`);
    } catch (pullErr) {
      // pull fails on empty/first-commit repos — that's OK, continue
      console.warn(`[${jobId}] Pull skipped (may be empty repo): ${pullErr.message}`);
    }

    // ── 3. Remove stale feature branch ────────────────────────────────────
    try {
      const { stdout: localList } = await run(`git branch --list ${featureBranch}`);
      if (localList.trim()) {
        await run(`git branch -D ${featureBranch}`);
        console.log(`[${jobId}] Deleted stale local branch: ${featureBranch}`);
      }
    } catch (_) {}

    // Also try to delete from remote (ignore failure if doesn't exist)
    try {
      await run(`git push origin --delete ${featureBranch}`);
      console.log(`[${jobId}] Deleted stale remote branch: ${featureBranch}`);
    } catch (_) {}

    // ── 4. Create fresh feature branch ────────────────────────────────────
    await run(`git checkout -b ${featureBranch}`);
    console.log(`[${jobId}] Created branch: ${featureBranch}`);

    // ── 5. Stage specific file only ───────────────────────────────────────
    await run(`git add -- "${codeFileName}"`);
    console.log(`[${jobId}] Staged: ${codeFileName}`);

    // ── 6. Commit ─────────────────────────────────────────────────────────
    const safeMsg = commitMessage.replace(/"/g, "'");
    await run(`git commit -m "${safeMsg}"`);
    console.log(`[${jobId}] Committed: ${safeMsg}`);

    // ── 7. Push ───────────────────────────────────────────────────────────
    await run(`git push -u origin ${featureBranch}`);
    console.log(`[${jobId}] Pushed: ${featureBranch}`);

    // ── 8. Wait for GitHub to register the branch ─────────────────────────
    console.log(`[${jobId}] Waiting 3s for GitHub to register push...`);
    await sleep(3000);

    // ── 9. Create PR ──────────────────────────────────────────────────────
    const safeTitle = prTitle.replace(/"/g, "'");
    const safeBody  = prBody.replace(/"/g, "'");
    let prUrl;
    try {
      const { stdout: prOut } = await run(
        `gh pr create --title "${safeTitle}" --body "${safeBody}" --base ${defaultBranch} --head ${featureBranch}`
      );
      prUrl = prOut.trim().split('\n').find((l) => l.startsWith('https://')) || prOut.trim();
      console.log(`[${jobId}] PR created: ${prUrl}`);
    } catch (prErr) {
      // If PR exists already, extract the URL from the error message
      const existingUrl = prErr.message.match(/https:\/\/github\.com\/\S+\/pull\/\d+/);
      if (existingUrl) {
        prUrl = existingUrl[0];
        console.log(`[${jobId}] PR already exists: ${prUrl}`);
      } else {
        throw prErr;
      }
    }

    // ── 10. Return to default branch ──────────────────────────────────────
    await run(`git checkout ${defaultBranch}`);

    return { success: true, branch: featureBranch, defaultBranch, prUrl };

  } catch (err) {
    console.error(`[${jobId}] Git error: ${err.message}`);
    // Best-effort: try to get back to a clean state
    try {
      const defaultBranch = await detectDefaultBranch(root, jobId);
      await run(`git checkout ${defaultBranch}`);
    } catch (_) {}
    return { success: false, error: err.message };
  }
}

module.exports = { createBranchAndPR };
