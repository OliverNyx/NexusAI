# AI Agent Rules

Follow .gitnexus/RULES.md for all project context and coding guidelines.

This project uses GitNexus MCP for code intelligence. See .gitnexus/RULES.md for available tools and best practices.

<!-- gitnexus:start -->
# GitNexus MCP

This project is indexed as **GitnexusV2** by GitNexus, providing AI agents with deep code intelligence.

## Project: GitnexusV2

| Metric | Count |
|--------|-------|
| Files | 147 |
| Symbols | 940 |
| Relationships | 2298 |
| Clusters | 13 |
| Processes | 67 |

> **Staleness:** If the index is out of date, run `gitnexus_analyze({repo: "GitnexusV2"})` to refresh. The `gitnexus://repo/GitnexusV2/context` resource will warn you when the index is stale.

## Quick Start

```
1. READ gitnexus://repos                          → Discover all indexed repos
2. READ gitnexus://repo/GitnexusV2/context     → Get codebase overview (~150 tokens)
3. READ gitnexus://repo/GitnexusV2/clusters    → See all functional clusters
4. gitnexus_search({query: "...", repo: "GitnexusV2"}) → Find code by query
```

## Available Resources

| Resource | Purpose |
|----------|---------|
| `gitnexus://repos` | List all indexed repositories |
| `gitnexus://repo/GitnexusV2/context` | Codebase stats, tools, and resources overview |
| `gitnexus://repo/GitnexusV2/clusters` | All clusters with symbol counts and cohesion |
| `gitnexus://repo/GitnexusV2/cluster/{name}` | Cluster members and details |
| `gitnexus://repo/GitnexusV2/processes` | All execution flows with types |
| `gitnexus://repo/GitnexusV2/process/{name}` | Full process trace with steps |
| `gitnexus://repo/GitnexusV2/schema` | Graph schema for Cypher queries |

## Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `list_repos` | Discover indexed repos | First step with multiple repos |
| `search` | Semantic + keyword search | Finding code by query |
| `overview` | List clusters & processes | Understanding architecture |
| `explore` | Deep dive on symbol/cluster/process | Detailed investigation |
| `impact` | Blast radius analysis | Before making changes |
| `cypher` | Raw graph queries | Complex analysis |
| `analyze` | Re-index repository | When index is stale or after major code changes |

> **Multi-repo:** When multiple repos are indexed, pass `repo: "GitnexusV2"` to target this project.

## Workflow Examples

### Exploring the Codebase
```
READ gitnexus://repos                            → Discover repos
READ gitnexus://repo/GitnexusV2/context       → Stats and overview (check for staleness)
READ gitnexus://repo/GitnexusV2/clusters      → Find relevant cluster by name
READ gitnexus://repo/GitnexusV2/cluster/{name} → See members of that cluster
gitnexus_explore({name: "<symbol_name>", type: "symbol", repo: "GitnexusV2"})
```

### Planning a Change
```
gitnexus_search({query: "<what you want to change>", repo: "GitnexusV2"})
gitnexus_impact({target: "<symbol_name>", direction: "upstream", repo: "GitnexusV2"})
READ gitnexus://repo/GitnexusV2/processes     → Check affected execution flows
```

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process

**Relationships:** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
// Example: Find callers of a function
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- gitnexus:end -->
