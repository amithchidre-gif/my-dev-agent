const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function detectDefaultBranch(projectRoot) {
    try {
        const { stdout } = await execPromise(`git remote show origin`, { cwd: projectRoot });
        const match = stdout.match(/HEAD branch: (\S+)/);
        if (match && match[1]) {
            return match[1];
        }
    } catch (e) {}
    
    try {
        const { stdout } = await execPromise(`git symbolic-ref refs/remotes/origin/HEAD`, { cwd: projectRoot });
        const branch = stdout.trim().replace('refs/remotes/origin/', '');
        if (branch) return branch;
    } catch (e) {}
    
    return 'master';
}

async function ensureGitUser(projectRoot) {
    try {
        await execPromise(`git config user.email`, { cwd: projectRoot });
        await execPromise(`git config user.name`, { cwd: projectRoot });
    } catch (e) {
        await execPromise(`git config user.email "agent@local.dev"`, { cwd: projectRoot });
        await execPromise(`git config user.name "Dev Agent"`, { cwd: projectRoot });
    }
}

async function createBranchAndPR(ticketId, task, jobId, codeFileName) {
    const branchName = `feature/${ticketId}`;
    const commitMessage = `feat(${ticketId}): ${task ? task.substring(0, 50) : 'auto-generated'}`;
    const prTitle = `feat(${ticketId}): ${task ? task.substring(0, 60) : 'auto-generated'}`;
    const prBody = `## Ticket: ${ticketId}\n\n## Task\n${task || 'Code generation'}\n\n## Changes\n- Added ${codeFileName}`;

    const projectRoot = path.join(__dirname, '..');

    try {
        const defaultBranch = await detectDefaultBranch(projectRoot);
        console.log(`[${jobId}] Default branch: ${defaultBranch}`);

        await ensureGitUser(projectRoot);

        await execPromise(`git checkout ${defaultBranch}`, { cwd: projectRoot });
        await execPromise(`git pull origin ${defaultBranch}`, { cwd: projectRoot }).catch(() => {});

        const { stdout: branchCheck } = await execPromise(`git branch --list ${branchName}`, { cwd: projectRoot });
        if (branchCheck.trim()) {
            await execPromise(`git branch -D ${branchName}`, { cwd: projectRoot });
        }

        try {
            await execPromise(`git push origin --delete ${branchName}`, { cwd: projectRoot });
        } catch (e) {}

        await execPromise(`git checkout -b ${branchName}`, { cwd: projectRoot });
        console.log(`[${jobId}] Created branch: ${branchName}`);

        await execPromise(`git add -f "${codeFileName}"`, { cwd: projectRoot });
        await execPromise(`git commit -m "${commitMessage}"`, { cwd: projectRoot });
        console.log(`[${jobId}] Committed: ${commitMessage}`);

        await execPromise(`git push -u origin ${branchName}`, { cwd: projectRoot });
        console.log(`[${jobId}] Pushed branch: ${branchName}`);

        await sleep(3000);

        const prResult = await execPromise(
            `gh pr create --title "${prTitle}" --body "${prBody}" --base ${defaultBranch} --head ${branchName}`,
            { cwd: projectRoot }
        );
        console.log(`[${jobId}] PR created: ${prResult.stdout}`);

        await execPromise(`git checkout ${defaultBranch}`, { cwd: projectRoot });

        return { success: true, branch: branchName, prUrl: prResult.stdout.trim() };
    } catch (error) {
        console.error(`[${jobId}] Git error:`, error.message);
        const prMatch = error.message.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/);
        if (prMatch) {
            return { success: true, prUrl: prMatch[0] };
        }
        return { success: false, error: error.message };
    }
}

module.exports = { createBranchAndPR };
