# PCPM (Persistent Code Plan Memory) Integration

This project uses the global-brain PCPM system for persistent memory across sessions.

**Project ID:** Plugin-SIN-Swarm
**Current Goal:** Continue development

## Rules for All Agents

1. Before starting work, load the active context from `.pcpm/active-context.json`
2. Follow the current plan in `.pcpm/plan/latest.json` — do NOT improvise
3. Never reuse strategies listed in the memory's `forbidden` entries
4. After completing work, ensure knowledge is extracted and synced
5. If the strategy must change, document the decision explicitly
6. Check `.pcpm/knowledge-summary.json` for known mistakes before debugging
