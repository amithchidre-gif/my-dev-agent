<!-- AUTO-GENERATED from memory/project-memory.json — do not edit by hand -->
# Project Memory

> Last updated: 2026-04-18 · Schema: 1.0.0

## Project
- **Name**: Dev Studio
- **Phase**: Phase 1-3
- **Repo style**: monorepo

## Tech Stack
- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Containerisation**: Docker (node:20-alpine)
- **CI**: GitHub Actions
- **Orchestration**: Paperclip

### Testing Tools
| Type | Tool |
|---|---|
| Unit | Vitest |
| Integration | Supertest |
| E2E | Playwright |
| AI | custom ai-validators.js + ai-tests.js |

## Agents
| Agent | Entry point | Port |
|---|---|---|
| Dev Agent | `src/server.js` | 3000 |
| QA Agent | `src/qa-server.js` | 3003 |

## Architecture Decisions
| ID | Title | Status |
|---|---|---|
| DEC-001 | QA agent runs on a separate port (3003) | accepted |
| DEC-002 | Strict failure-payload contract (5 required fields) | accepted |
| DEC-003 | Retry loop guard with escalation to CTO Agent | accepted |
| DEC-004 | No-progress detection in feedback loop (fingerprint comparison) | accepted |
| DEC-005 | Docker multi-stage build targeting node:20-alpine with non-root user | accepted |
| DEC-006 | Shared project memory stored in memory/project-memory.json | accepted |

## Constraints
| ID | Constraint |
|---|---|
| CON-001 | No mobile apps in Phase 1-3 |
| CON-002 | No merge to main without QA pass |
| CON-003 | Max 3 QA retries before CTO escalation |
| CON-004 | QA Agent only tests Definition of Done — no scope creep |
| CON-005 | All secrets injected via environment variables — never committed |
| CON-006 | Evidence files written to ./evidence — excluded from git |

## Testing Strategy
- Unit: `vitest run`
- Integration: `vitest run --config vitest.integration.config.js`
- E2E: `playwright test`
- AI: `node src/qa/ai-tests.js`
- **Max retries**: 3

## Environments
### dev
- **branch**: dev
- **compose_file**: docker-compose.yml
- **env_file**: .env.dev
- **node_env**: development

### staging
- **branch**: main (PR preview)
- **compose_file**: docker-compose.staging.yml
- **env_file**: .env.staging
- **node_env**: staging
- **ci_trigger**: pull_request → main
