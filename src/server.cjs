const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { createBranchAndPR } = require('./git.cjs');

const app = express();
const PORT = process.env.PORT || 3000;

const logsDir = path.join(__dirname, '..', 'logs');
const workspaceDir = path.join(__dirname, '..', 'workspace');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true });

app.use(express.json());

app.post('/api/create-job', async (req, res) => {
    const { task, context, ticketId } = req.body;
    const jobId = `job_${Date.now()}`;
    
    const logEntry = { timestamp: new Date().toISOString(), jobId, task, ticketId, context };
    fs.appendFileSync(path.join(logsDir, 'tasks.log'), JSON.stringify(logEntry) + '\n');
    console.log(`[${jobId}] Task: ${task}`);
    console.log(`[${jobId}] Ticket: ${ticketId || 'N/A'}`);
    
    const command = `copilot -p "${task.replace(/"/g, '\\"')}" --allow-all-tools --output-format json`;
    
    try {
        const { stdout } = await execPromise(command, { timeout: 60000 });
        const outputFile = path.join(workspaceDir, `${jobId}.output.json`);
        fs.writeFileSync(outputFile, stdout);
        console.log(`[${jobId}] Copilot completed`);
        
        if (ticketId) {
            const gitResult = await createBranchAndPR(ticketId, task, jobId);
            if (gitResult.success) {
                res.json({ 
                    status: "completed", 
                    jobId, 
                    output: stdout,
                    git: { branch: gitResult.branch, prUrl: gitResult.prUrl }
                });
            } else {
                res.status(207).json({ 
                    status: "partial", 
                    jobId, 
                    output: stdout,
                    gitError: gitResult.error || gitResult.reason
                });
            }
        } else {
            res.json({ status: "completed", jobId, output: stdout });
        }
    } catch (error) {
        console.error(`[${jobId}] Error:`, error.message);
        res.json({ status: "error", jobId, message: error.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
