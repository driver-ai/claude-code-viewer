# Claude Code Viewer — Driver Fork

This is Driver's fork of [`d-kimuson/claude-code-viewer`](https://github.com/d-kimuson/claude-code-viewer)
with Driver-specific additions on top of the upstream project:

- **Benchmark Candidate** panel — scores a session's suitability as an eval benchmark.
- **Export to ATIF** — convert a session log into an ATIF trajectory via [`logs2atif`](https://github.com/driver-ai/logs2atif).

The upstream [`README.md`](./README.md) documents the published npm package (`npx @kimuson/claude-code-viewer`)
and the full feature set. **This guide instead covers running the Driver fork from a local clone.**

## Prerequisites

- **Node.js** 24.14.0 or later (see [`.node-version`](./.node-version))
- **pnpm** (this repo uses pnpm, not npm — the easiest way to get the pinned version is Corepack)
- **Claude Code** v1.0.125 or later (the viewer reads its session logs from `~/.claude/projects/`)
- **git**

## Clone, Install, Run

```bash
# 1. Clone the Driver fork
git clone git@github.com:driver-ai/claude-code-viewer.git
cd claude-code-viewer

# 2. Enable Corepack so the correct pnpm version is used automatically
corepack enable

# 3. Install dependencies
pnpm install
```

### Development mode (recommended for local work)

```bash
pnpm dev
```

This runs the frontend and backend together:

- Frontend (Vite): http://localhost:3400
- Backend (Hono API): http://localhost:3401 (the frontend proxies `/api` to it)

Open http://localhost:3400 in your browser.

### Production mode

Build the bundle and serve the UI + API from a single port (3000 by default, override with `PORT`):

```bash
pnpm build
pnpm start
```

## Optional: Install `logs2atif` (for ATIF export)

The **Export to ATIF** button only works if the converter can be found on the host. It's optional —
everything else works without it. You need **either** `uv` **or** a pre-installed `logs2atif`:

```bash
# Option A (recommended): install uv. The viewer then provisions logs2atif on demand
# via `uvx` / `uv tool run` (needs Python 3.11+, managed by uv).
curl -LsSf https://astral.sh/uv/install.sh | sh

# Option B: install logs2atif yourself (pinned to `develop`, the default branch).
uv tool install "git+https://github.com/driver-ai/logs2atif@develop"
```

Resolution order at runtime: an existing `logs2atif` on `PATH`, then `uvx`, then `uv tool run`. If
none are found, the export dialog still opens and shows the command it attempted plus install
instructions. The first `uvx`/`uv` run may take a few seconds while the environment is provisioned.

## The "Benchmark Candidate" Panel

A right-panel tab (flask icon) that analyzes a session and rates how good a candidate it is for an
agent **eval benchmark**. It surfaces two scores — **Context Difficulty** (how much exploration the
task required: files read, searches, exploration turns, etc.) and **Verifiability** (whether the
outcome is checkable: crisp task statement, tests run, quality gate, commit/PR) — plus session cost
and Driver MCP usage. At the bottom of the panel, **Export to ATIF** converts the session for use in
downstream data pipelines.

## More Docs

- [`README.md`](./README.md) — upstream usage, full feature list, configuration reference.
- [`docs/dev.md`](./docs/dev.md) — architecture, quality gates, project structure, contribution flow.
- [`AGENTS.md`](./AGENTS.md) — coding conventions for working in this repo.
