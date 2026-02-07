# GitNexus

**Graph-powered code intelligence for AI agents.** Index any codebase into a knowledge graph, then query it via MCP or CLI.

Works with **Cursor**, **Claude Code**, **Windsurf**, **Cline**, **OpenCode**, and any MCP-compatible tool.

[![npm version](https://img.shields.io/npm/v/gitnexus.svg)](https://www.npmjs.com/package/gitnexus)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/License-PolyForm%20Noncommercial-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0/)

---

## Why?

AI coding tools don't understand your codebase structure. They edit a function without knowing 47 other functions depend on it. GitNexus fixes this by **precomputing every dependency, call chain, and relationship** into a queryable graph.

**Three commands to give your AI agent full codebase awareness.**

## Quick Start

```bash
# Install
npm install -g gitnexus

# One-time: configure MCP for your editors
gitnexus setup

# Index your repository (run from repo root)
gitnexus analyze

# Done! Open your editor — MCP connects automatically.
```

Or without installing globally:

```bash
npx gitnexus setup       # one-time
npx gitnexus analyze     # per repo
```

The `setup` command auto-detects Cursor, Claude Code, and OpenCode, then writes the correct global MCP config. You only run it once.

## MCP Setup (manual)

If you prefer to configure manually instead of using `gitnexus setup`:

### Cursor / Windsurf

Add to `~/.cursor/mcp.json` (global — works for all projects):

```json
{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

### Claude Code

```bash
claude mcp add gitnexus -- npx -y gitnexus@latest mcp
```

### OpenCode

Add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus@latest", "mcp"]
    }
  }
}
```

## What It Does

GitNexus indexes your codebase through 7 phases:

1. **Structure** — File/folder tree
2. **Parse** — AST extraction via Tree-sitter (9 languages)
3. **Imports** — Resolve import paths (including TS path aliases, Rust modules, Java wildcards, Go packages)
4. **Calls** — Function call resolution with confidence scoring (0.3-0.9)
5. **Heritage** — Class extends/implements chains
6. **Communities** — Leiden algorithm clusters related code into functional groups
7. **Processes** — Entry point detection and execution flow tracing

The result is a **KuzuDB graph database** stored locally in `.gitnexus/` with full-text search and semantic embeddings.

## MCP Tools

Your AI agent gets these tools automatically:

| Tool | What It Does | `repo` Param |
|------|-------------|--------------|
| `list_repos` | Discover all indexed repositories | — |
| `search` | Hybrid search (BM25 + semantic) with cluster context | Optional |
| `overview` | List all clusters and processes | Optional |
| `explore` | Deep dive on a symbol, cluster, or process | Optional |
| `impact` | Blast radius analysis | Optional |
| `cypher` | Raw Cypher graph queries | Optional |
| `analyze` | Index or re-index a repository | Optional |

> With one indexed repo, the `repo` param is optional. With multiple, specify which: `search({query: "auth", repo: "my-app"})`.

## MCP Resources

| Resource | Purpose |
|----------|---------|
| `gitnexus://repos` | List all indexed repositories (read first) |
| `gitnexus://repo/{name}/context` | Codebase stats and overview |
| `gitnexus://repo/{name}/clusters` | All functional clusters |
| `gitnexus://repo/{name}/cluster/{name}` | Cluster members and details |
| `gitnexus://repo/{name}/processes` | All execution flows |
| `gitnexus://repo/{name}/process/{name}` | Full process trace |
| `gitnexus://repo/{name}/schema` | Graph schema for Cypher queries |

## CLI Commands

```bash
gitnexus setup                # Configure MCP for your editors (one-time)
gitnexus analyze [path]       # Index a repository (or update stale index)
gitnexus analyze --force      # Force full re-index
gitnexus mcp                  # Start MCP server (stdio) — serves all indexed repos
gitnexus serve                # Start HTTP server for web UI
gitnexus list                 # List all indexed repositories
gitnexus status               # Show index status for current repo
gitnexus clean                # Delete index for current repo
gitnexus clean --all          # Delete all indexes
```

## Multi-Repo Support

GitNexus supports indexing multiple repositories. Each `gitnexus analyze` registers the repo in a global registry (`~/.gitnexus/registry.json`). The MCP server serves all indexed repos automatically with lazy KuzuDB connections.

## Supported Languages

TypeScript, JavaScript, Python, Java, C, C++, C#, Go, Rust

## How Impact Analysis Works

```
gitnexus_impact({target: "UserService", direction: "upstream", repo: "my-app"})

TARGET: Class UserService (src/services/user.ts)

UPSTREAM (what depends on this):
  Depth 1 (direct callers):
    handleLogin [CALLS 90%] → src/api/auth.ts:45
    handleRegister [CALLS 90%] → src/api/auth.ts:78
  Depth 2:
    authRouter [IMPORTS] → src/routes/auth.ts

8 files affected, 3 clusters touched
```

Options: `maxDepth`, `minConfidence`, `relationTypes`, `includeTests`

## Agent Skills

GitNexus ships with skill files that teach AI agents how to use the tools effectively:

- **Exploring** — Navigate unfamiliar code using the knowledge graph
- **Debugging** — Trace bugs through call chains
- **Impact Analysis** — Analyze blast radius before changes
- **Refactoring** — Plan safe refactors using dependency mapping

These are installed automatically to `.claude/skills/` when you run `gitnexus analyze`.

## Requirements

- Node.js >= 18
- Git repository (uses git for commit tracking)

## Privacy

- All processing happens locally on your machine
- No code is sent to any server
- Index stored in `.gitnexus/` inside your repo (gitignored)
- Global registry at `~/.gitnexus/` stores only paths and metadata

## Web UI

GitNexus also has a browser-based UI at [gitnexus.vercel.app](https://gitnexus.vercel.app) — 100% client-side, your code never leaves the browser.

## License

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/)

Free for non-commercial use. Contact for commercial licensing.
