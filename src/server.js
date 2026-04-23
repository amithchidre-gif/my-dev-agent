const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { createBranchAndPR } = require('./git');
const { logEntry } = require('./logger');

const app = express();
const PORT = process.env.PORT || 3002;

const logsDir = path.join(__dirname, '..', 'logs');
const workspaceDir = path.join(__dirname, '..', 'workspace');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

app.use(express.json());

// Resolve agent binary
const agentCmd = process.platform === 'win32' ? 'cursor-agent.exe' : 'cursor-agent';
console.log(`[boot] Platform: ${process.platform} | agent: ${agentCmd}`);

function extractCodeFromAgentOutput(stdout, task) {
    try {
        const lines = stdout.split('\n').filter(line => line.trim());
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'assistant.message' && parsed.data && parsed.data.content) {
                    const content = parsed.data.content;
                    const codeMatch = content.match(/```(?:python|javascript)?\n([\s\S]*?)```/);
                    if (codeMatch) return codeMatch[1].trim();
                }
            } catch (e) {}
        }
    } catch (e) {}
    
    const directMatch = stdout.match(/```(?:python|javascript)?\n([\s\S]*?)```/);
    if (directMatch) return directMatch[1].trim();
    
    return `# Code generated for: ${task}\nprint("Hello from Dev Agent")`;
}

app.post('/api/create-job', async (req, res) => {
    const { task, context, ticketId } = req.body;
    const jobId = `job_${Date.now()}`;

    if (!ticketId) {
        return res.status(400).json({ status: "error", message: "ticketId is required" });
    }

    logEntry('ai-coding-agent', task, 'received');
    console.log(`[${jobId}] Task: ${task} | Ticket: ${ticketId}`);

    const command = `${agentCmd} -p "${task.replace(/"/g, '\\"')}" --print --output-format json --trust`;

    try {
        const { stdout } = await execPromise(command, { timeout: 60000 });
        const outputFile = path.join(workspaceDir, `${jobId}.output.json`);
        fs.writeFileSync(outputFile, stdout);
        console.log(`[${jobId}] cursor-agent completed`);

        const codeContent = extractCodeFromAgentOutput(stdout, task);
        const codeFileName = `${ticketId}_solution.py`;
        const codeFilePath = path.join(__dirname, '..', codeFileName);
        fs.writeFileSync(codeFilePath, codeContent);
        console.log(`[${jobId}] Code saved → ${codeFilePath}`);

        const gitResult = await createBranchAndPR(ticketId, task, jobId, codeFileName);
        
        if (gitResult.success) {
            logEntry('ai-coding-agent', task, 'completed');
            res.json({
                status: "completed",
                jobId,
                codeFile: codeFileName,
                branch: gitResult.branch,
                prUrl: gitResult.prUrl
            });
        } else {
            logEntry('ai-coding-agent', task, 'partial');
            res.status(207).json({
                status: "partial",
                jobId,
                error: gitResult.error
            });
        }
    } catch (error) {
        logEntry('ai-coding-agent', task, 'error');
        console.error(`[${jobId}] Error:`, error.message);
        res.json({ status: "error", jobId, message: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
