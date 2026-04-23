const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Intelligent retry logic for Copilot CLI calls
 * @param {Function} fn - Async function to execute
 * @param {Object} context - Task context (task, ticketId, etc.)
 * @param {number} maxAttempts - Maximum retry attempts (default: 3)
 * @returns {Promise<Object>} - Result or escalation object
 */
async function executeWithRetry(fn, context, maxAttempts = 3) {
    const errors = [];
    const approaches = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`[retry] Attempt ${attempt}/${maxAttempts} for task: ${context.task?.substring(0, 50)}`);

        try {
            // Pass previous error context to the function
            const previousError = errors.length > 0 ? errors[errors.length - 1] : null;
            const previousApproaches = [...approaches];
            
            const result = await fn(context, { attempt, previousError, previousApproaches });
            
            console.log(`[retry] Attempt ${attempt} succeeded`);
            return { success: true, result, attempts: attempt };
            
        } catch (error) {
            console.error(`[retry] Attempt ${attempt} failed:`, error.message);
            errors.push({ attempt, message: error.message, timestamp: new Date().toISOString() });
            approaches.push(error.approach || 'unknown');
            
            if (attempt === maxAttempts) {
                console.log(`[retry] All ${maxAttempts} attempts failed. Escalating.`);
                return {
                    success: false,
                    escalated: true,
                    attempts: maxAttempts,
                    errors: errors,
                    approaches: approaches,
                    recommendation: "Manual intervention required. Check task requirements and try again.",
                    lastTask: context.task
                };
            }
            
            // Wait before retry (exponential backoff: 1s, 2s, 4s)
            const delay = Math.pow(2, attempt - 1) * 1000;
            console.log(`[retry] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Wrapper for Copilot CLI with retry and context
 */
async function executeCopilotWithRetry(command, context) {
    const fn = async (ctx, retryInfo) => {
        let enhancedCommand = command;
        
        // Add retry context if this is a retry
        if (retryInfo.attempt > 1 && retryInfo.previousError) {
            const retryHint = `\n\n[IMPORTANT - RETRY ATTEMPT ${retryInfo.attempt}]\nPrevious attempt failed with error: ${retryInfo.previousError.message}\nPlease try a DIFFERENT approach. Do NOT repeat the same solution that failed.\nPrevious approaches tried: ${retryInfo.previousApproaches.join(', ') || 'none'}`;
            enhancedCommand = command.replace(/-p "([^"]*)"/, (match, prompt) => {
                return `-p "${prompt}${retryHint}"`;
            });
        }
        
        const { stdout, stderr } = await execPromise(enhancedCommand, { timeout: 60000 });
        if (stderr && !stdout) {
            const error = new Error(stderr);
            error.approach = `approach_${retryInfo.attempt}`;
            throw error;
        }
        return stdout;
    };
    
    return executeWithRetry(fn, context, 3);
}

module.exports = { executeWithRetry, executeCopilotWithRetry };
