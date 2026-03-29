# opencode-omoc-swarm

OpenCode swarm plugin for side-by-side multi-agent workflows.

## Tools

- `swarm.create` — create a swarm (child sessions)
- `swarm.discover` — recover a swarm from existing sessions and registry state
- `swarm.status` — show members + session IDs
- `swarm.parallel` — run a prompt across members (parallel where possible)
- `swarm.send` — message another member (routes as a prompt)
- `swarm.forget` — forget local swarm mapping (sessions remain)
- `swarm.max` — MAX mode: parallel editor tries in isolated git worktrees + selector picks winner (optional apply)
- `swarm.jam` — collaborative run in the same worktree (no isolation)

## Compatibility

Supported agent IDs:

- `plan`
- `build`
- `explore`
- `general`
- `oracle`
- `metis`
- `momus`
- `librarian`

Legacy aliases remain supported:

- `planner` → `plan`
- `researcher` → `explore`
- `coder` → `build`
- `reviewer` → `general`

The plugin is verified against the local registry tests in `plugins/registry.test.ts` and `plugins/registry-roundtrip.test.ts`.

## Runtime assumptions

- `tmux`, `curl`, `jq`, `lsof`, and `opencode` must be on `PATH`
- `bin/oc-swarm` starts one headless OpenCode server plus four side-by-side panes
- the project must contain `.opencode/plugins/omoc-swarm.ts` for the launcher workflow
- `opencode` should support `serve` and `attach` as used by `bin/oc-swarm`

## Live E2E Tests

The live E2E test suite (`scripts/oc-swarm-e2e.test.sh`) validates the actual OpenCode runtime:

- Tests real OpenCode server startup and API endpoints
- Validates session creation and management
- Verifies tmux integration
- Checks all required dependencies

Run with: `bun run test:e2e`

For CI: `bun run ci:with-e2e` (runs all CI checks + live E2E)

**Note:** The live E2E tests will skip gracefully if `opencode` is not available on PATH.

## Install (per project)

Copy the plugin into your project so plain `opencode` can auto-load it:

```bash
mkdir -p .opencode/plugins
cp /path/to/opencode-omoc-swarm/plugins/omoc-swarm.ts .opencode/plugins/omoc-swarm.ts
```

For the side-by-side wrapper:

```bash
mkdir -p bin
cp /path/to/opencode-omoc-swarm/bin/oc-swarm bin/oc-swarm
cp /path/to/opencode-omoc-swarm/templates/bin/opencode bin/opencode
cp /path/to/opencode-omoc-swarm/templates/.envrc .envrc
chmod +x bin/oc-swarm bin/opencode
direnv allow
```

## Launcher

```bash
./bin/oc-swarm --dir /path/to/project
```

## Development

```bash
bun run plugins/registry.test.ts
bun run plugins/registry-roundtrip.test.ts
bash scripts/oc-swarm-smoke.test.sh
```

## Operational scripts

```bash
bun run observe stats
bun run observe history <swarmId>
bun run observe export <swarmId> json
bun run memory list
bun run eval
```

## Notes

- Queue runner support is not implemented.
- Title parsing is only a legacy discovery fallback; registry state is the source of truth for agent identity.
