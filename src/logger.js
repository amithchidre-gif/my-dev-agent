const fs = require('fs');
const path = require('path');

const LOGS_DEV_DIR = path.join(__dirname, '..', 'logs', 'dev');

function logEntry(agent, task, status) {
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const file = path.join(LOGS_DEV_DIR, `${date}.jsonl`);
  const entry = JSON.stringify({
    agent,
    task,
    status,
    timestamp: new Date().toISOString()
  });
  fs.appendFileSync(file, entry + '\n');
}

module.exports = { logEntry };
