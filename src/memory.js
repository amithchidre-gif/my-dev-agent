'use strict';

/**
 * src/memory.js — Shared Project Memory for Dev Studio
 *
 * Single access point for all agents to read and write project memory for the Dev Studio project.
 * Canonical store: memory/project-memory.json
 * Human-readable mirror: PROJECT_MEMORY.md (synced on every write)
 *
 * Usage:
 *   const memory = require('./memory');
 *
 *   memory.get('tech_stack')          // read a top-level section
 *   memory.get('constraints')         // returns the constraints array
 *   memory.getDecision('DEC-003')     // lookup by id
 *   memory.addDecision({ ... })       // append a decision + auto-save
 *   memory.addConstraint({ ... })     // append a constraint + auto-save
 *   memory.set('project', 'phase', 'Phase 4')  // update a scalar field
 *   memory.save()                     // explicit write (also syncs markdown)
 *   memory.toMarkdown()               // returns markdown string
 *   memory.syncMarkdown()             // writes PROJECT_MEMORY.md
 */

const fs   = require('fs');
const path = require('path');

const MEMORY_PATH   = path.resolve(__dirname, '..', 'memory', 'project-memory.json');
const MARKDOWN_PATH = path.resolve(__dirname, '..', 'PROJECT_MEMORY.md');

// ─── Internal helpers ────────────────────────────────────────────────────────

function _load() {
  const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
  return JSON.parse(raw);
}

function _write(data) {
  data._meta.last_updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Public API ──────────────────────────────────────────────────────────────

const memory = {
  /**
   * Read a top-level section from project memory.
   * @param {string} section  e.g. 'tech_stack', 'decisions', 'constraints'
   * @returns {*}
   */
  get(section) {
    const data = _load();
    if (section === undefined) return data;
    if (!(section in data)) throw new Error(`memory.get: unknown section "${section}"`);
    return data[section];
  },

  /**
   * Update a scalar field inside a section.
   * memory.set('project', 'phase', 'Phase 4')
   */
  set(section, key, value) {
    const data = _load();
    if (!(section in data)) throw new Error(`memory.set: unknown section "${section}"`);
    if (typeof data[section] !== 'object' || Array.isArray(data[section])) {
      throw new Error(`memory.set: section "${section}" is not an object`);
    }
    data[section][key] = value;
    _write(data);
    this.syncMarkdown();
    return data[section];
  },

  /**
   * Find a decision by id.
   * @param {string} id  e.g. 'DEC-003'
   * @returns {object|undefined}
   */
  getDecision(id) {
    return _load().decisions.find(d => d.id === id);
  },

  /**
   * Append a new architecture decision.
   * If id is omitted, one is auto-assigned (DEC-NNN).
   * @param {{ id?, date?, title, rationale, status? }} decision
   */
  addDecision(decision) {
    const data = _load();
    const next = data.decisions.length + 1;
    const entry = {
      id:        decision.id        || `DEC-${String(next).padStart(3, '0')}`,
      date:      decision.date      || new Date().toISOString().slice(0, 10),
      title:     decision.title,
      rationale: decision.rationale || '',
      status:    decision.status    || 'accepted',
    };
    data.decisions.push(entry);
    _write(data);
    this.syncMarkdown();
    return entry;
  },

  /**
   * Find a constraint by id.
   * @param {string} id  e.g. 'CON-002'
   * @returns {object|undefined}
   */
  getConstraint(id) {
    return _load().constraints.find(c => c.id === id);
  },

  /**
   * Append a new constraint.
   * @param {{ id?, constraint }} constraint
   */
  addConstraint(constraint) {
    const data = _load();
    const next = data.constraints.length + 1;
    const entry = {
      id:         constraint.id || `CON-${String(next).padStart(3, '0')}`,
      constraint: constraint.constraint,
    };
    data.constraints.push(entry);
    _write(data);
    this.syncMarkdown();
    return entry;
  },

  /**
   * Explicitly save the full data object (advanced use).
   * @param {object} data  Full memory object as returned by memory.get()
   */
  save(data) {
    _write(data);
    this.syncMarkdown();
  },

  /**
   * Render current memory as a Markdown string.
   * @returns {string}
   */
  toMarkdown() {
    const d = _load();

    const stack = d.tech_stack;
    const testing = stack.testing;

    const agentRows = d.architecture.agents
      .map(a => `| ${a.name} | \`${a.entry}\` | ${a.port} |`)
      .join('\n');

    const decisionRows = d.decisions
      .map(dec => `| ${dec.id} | ${dec.title} | ${dec.status} |`)
      .join('\n');

    const constraintRows = d.constraints
      .map(c => `| ${c.id} | ${c.constraint} |`)
      .join('\n');

    const envBlocks = Object.entries(d.environments)
      .map(([name, cfg]) => `### ${name}\n${Object.entries(cfg).map(([k, v]) => `- **${k}**: ${v}`).join('\n')}`)
      .join('\n\n');

    return `<!-- AUTO-GENERATED from memory/project-memory.json — do not edit by hand -->
# Project Memory

> Last updated: ${d._meta.last_updated} · Schema: ${d._meta.schema_version}

## Project
- **Name**: ${d.project.name}
- **Phase**: ${d.project.phase}
- **Repo style**: ${d.project.repository}

## Tech Stack
- **Runtime**: ${stack.runtime}
- **Framework**: ${stack.framework}
- **Containerisation**: ${stack.containerisation}
- **CI**: ${stack.ci}
- **Orchestration**: ${stack.orchestration}

### Testing Tools
| Type | Tool |
|---|---|
| Unit | ${testing.unit} |
| Integration | ${testing.integration} |
| E2E | ${testing.e2e} |
| AI | ${testing.ai} |

## Agents
| Agent | Entry point | Port |
|---|---|---|
${agentRows}

## Architecture Decisions
| ID | Title | Status |
|---|---|---|
${decisionRows}

## Constraints
| ID | Constraint |
|---|---|
${constraintRows}

## Testing Strategy
- Unit: \`${d.testing_strategy.unit.command}\`
- Integration: \`${d.testing_strategy.integration.command}\`
- E2E: \`${d.testing_strategy.e2e.command}\`
- AI: \`${d.testing_strategy.ai.command}\`
- **Max retries**: ${d.testing_strategy.max_retries}

## Environments
${envBlocks}
`;
  },

  /**
   * Write PROJECT_MEMORY.md from the current JSON store.
   */
  syncMarkdown() {
    fs.writeFileSync(MARKDOWN_PATH, this.toMarkdown(), 'utf8');
  },
};

module.exports = memory;
