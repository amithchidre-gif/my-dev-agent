/**
 * Lesson Builder - Converts QA failures and Dev fixes into structured lessons
 */

// Category detection keywords
const CATEGORY_KEYWORDS = {
  auth: ['auth', 'jwt', 'token', 'login', 'password', 'session', 'cors'],
  validation: ['valid', 'invalid', 'schema', 'required', 'missing', 'format'],
  api: ['api', 'endpoint', 'route', 'request', 'response', 'status'],
  database: ['db', 'database', 'query', 'sql', 'postgres', 'redis', 'migration'],
  ai: ['ai', 'model', 'llm', 'copilot', 'cursor', 'prompt', 'hallucination'],
  test: ['test', 'assert', 'expect', 'vitest', 'playwright', 'coverage'],
  docker: ['docker', 'container', 'compose', 'volume', 'network'],
  ci: ['ci', 'github', 'actions', 'pipeline', 'build'],
  ui: ['ui', 'react', 'component', 'css', 'frontend', 'browser'],
  memory: ['memory', 'cache', 'state', 'persist', 'store'],
  general: [] // fallback
};

// Detect category from text
function detectCategory(text) {
  const lowerText = text.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'general') continue;
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return category;
      }
    }
  }
  return 'general';
}

// Extract issue from failure data
function extractIssue(failure) {
  // Try to get from failures array first
  if (failure.failures && failure.failures.length > 0) {
    const firstFailure = failure.failures[0];
    return firstFailure.error || firstFailure.test_name || 'Test failed';
  }
  
  // Try direct error message
  if (failure.error) return failure.error;
  
  // Try stage info
  if (failure.failed_stage) return `${failure.failed_stage} stage failed`;
  
  // Fallback
  return 'Unknown failure';
}

// Extract fix from fixData
function extractFix(fixData) {
  if (fixData.summary) return fixData.summary;
  if (fixData.description) return fixData.description;
  if (fixData.fix) return fixData.fix;
  if (fixData.message) return fixData.message;
  if (fixData.changes && fixData.changes.length > 0) {
    return fixData.changes.join(', ');
  }
  return 'Code fix applied';
}

// Generate lesson from issue and fix
function generateLesson(issue, fix, category) {
  const templates = {
    auth: 'Always validate authentication tokens and set appropriate expiration times.',
    validation: 'Implement comprehensive input validation for all API endpoints.',
    api: 'Ensure API endpoints handle edge cases and return proper status codes.',
    database: 'Use proper database indexing and query optimization for better performance.',
    ai: 'Provide clear context and specific instructions when using AI coding tools.',
    test: 'Write tests that are deterministic and avoid race conditions.',
    docker: 'Ensure Docker containers have proper resource limits and health checks.',
    ci: 'CI pipelines should run tests in a deterministic, isolated environment.',
    ui: 'UI components should handle loading and error states gracefully.',
    memory: 'Persist important state to disk to survive process restarts.',
    general: 'Always test changes thoroughly and document lessons learned.'
  };
  
  const template = templates[category] || templates.general;
  return `${template} [Observed: "${issue.substring(0, 100)}" → Fixed by: "${fix.substring(0, 100)}"]`;
}

// Main builder function
function buildLesson(failure, fixData) {
  // Extract ticket_id
  const ticketId = failure.ticket_id || fixData.ticket_id || 'UNKNOWN';
  
  // Extract issue
  const issue = extractIssue(failure);
  
  // Extract fix
  const fix = extractFix(fixData);
  
  // Combine text for category detection
  const combinedText = `${issue} ${fix}`;
  const category = detectCategory(combinedText);
  
  // Generate lesson
  const lesson = generateLesson(issue, fix, category);
  
  return {
    ticket_id: ticketId,
    issue: issue,
    fix: fix,
    lesson: lesson,
    category: category
  };
}

module.exports = { buildLesson, detectCategory, extractIssue, extractFix };
