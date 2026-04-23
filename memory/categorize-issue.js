/**
 * Simple Categorization Function
 * Categorizes issue text into predefined categories
 */

const CATEGORY_KEYWORDS = {
  auth: ['auth', 'token', 'jwt', 'login', 'password', 'session', 'cors', 'credentials', 'permission', 'unauthorized', 'forbidden', 'authentication', 'authorization'],
  validation: ['valid', 'invalid', 'schema', 'required', 'missing', 'format', 'malformed', 'validation', 'input', 'parameter', 'field'],
  api: ['api', 'endpoint', 'route', 'request', 'response', 'status', 'http', 'rest', 'graphql', '404', '500', '503'],
  ui: ['ui', 'react', 'component', 'css', 'frontend', 'browser', 'dom', 'html', 'element', 'button', 'click', 'render', 'style'],
  performance: ['performance', 'slow', 'timeout', 'latency', 'response time', 'memory', 'cpu', 'optimization', 'cache', 'bottleneck'],
  ai: ['ai', 'model', 'llm', 'copilot', 'cursor', 'prompt', 'hallucination', 'openai', 'anthropic', 'claude', 'gpt'],
  other: [] // fallback
};

function categorizeIssue(issue) {
  const lowerIssue = issue.toLowerCase();
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'other') continue;
    
    for (const keyword of keywords) {
      if (lowerIssue.includes(keyword)) {
        console.log(`[categorize] "${issue.substring(0, 50)}..." → ${category} (matched: "${keyword}")`);
        return category;
      }
    }
  }
  
  console.log(`[categorize] "${issue.substring(0, 50)}..." → other (no keyword match)`);
  return 'other';
}

module.exports = { categorizeIssue, CATEGORY_KEYWORDS };
