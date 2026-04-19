// Environment-aware application configuration
// All values can be overridden via environment variables.

'use strict';

const env = process.env.NODE_ENV || 'development';

module.exports = {
  env,
  isDev: env === 'development',
  isStaging: env === 'staging',
  isProd: env === 'production',

  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    qaPort: parseInt(process.env.QA_PORT || '3003', 10),
  },

  qa: {
    apiKey: process.env.QA_API_KEY || '',
    evidenceDir: process.env.QA_EVIDENCE_DIR || './evidence',
    maxRetries: parseInt(process.env.QA_MAX_RETRIES || '3', 10),
    timeoutMs: parseInt(process.env.QA_TIMEOUT_MS || '30000', 10),
  },

  git: {
    envBranch: process.env.GIT_ENV_BRANCH || 'dev',
  },
};
