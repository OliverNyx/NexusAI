# GitNexus Feature Roadmap

Inspired by Noodlbox competitive analysis (Jan 2026).

---

## 🔥 High Priority

### Communities (Auto-detected Code Clusters)
- [ ] Implement Leiden/Louvain algorithm for community detection
- [ ] Run community detection post-ingestion on `CodeRelation` graph
- [ ] Add `Community` node table to KuzuDB schema
- [ ] Create `MEMBER_OF` relationship type
- [ ] Calculate cohesion score (0-1) per community
- [ ] Surface key symbols (highest centrality) per community
- [ ] Identify entry points (functions called from outside)

### Processes (Execution Flows)
- [ ] Detect entry points (functions with no internal callers)
- [ ] Trace forward call chains from entry points
- [ ] Store as `Process` nodes with `STEP_IN_PROCESS` relationships
- [ ] Label processes based on entry point + terminal action
- [ ] Classify as `intra_community` or `cross_community`

### Git Diff Impact Detection
- [ ] Add `detectImpact` MCP tool
- [ ] Accept `change_scope`: `unstaged`, `staged`, `all`, `compare`
- [ ] Parse git diff to extract changed symbols
- [ ] Run blast radius on changed symbols
- [ ] Return affected processes grouped by risk level

---

## 🟡 Medium Priority

### Labels (Human-readable Names)
- [ ] Generate `.gitnexus/labels.json` on analysis
- [ ] Store community labels (e.g., "Authentication System")
- [ ] Store process labels (e.g., "User Login Flow")
- [ ] Use labels in MCP tool output and UI

### Architecture Generation
- [ ] Add `/gitnexus:generate_map` command/tool
- [ ] Generate `ARCHITECTURE/README.md` with:
  - Codebase stats
  - Mermaid diagram of communities
  - Cross-community flows
- [ ] Generate `ARCHITECTURE/{process-slug}.md` per key process

### Centrality Scoring
- [ ] Calculate PageRank or betweenness centrality per symbol
- [ ] Store as `centrality` property on nodes
- [ ] Surface in search results and community views

---

## 🟢 Low Priority / Nice-to-Have

### Skills (Structured Prompts)
- [ ] Create skill prompts for common tasks:
  - Exploring Codebases
  - Debugging
  - Change Planning
  - Refactoring
  - Generating Documentation
- [ ] Expose as MCP prompts

### Session Hooks
- [ ] Inject codebase context at conversation start (Claude Code)
- [ ] Auto-inject graph schema for Cypher query accuracy

### Search Hooks
- [ ] Enhance grep/glob results with semantic context
- [ ] Add call graph context to file search results

### Depth Parameter
- [ ] Add `depth` param to search tools: `definitions` | `full`
- [ ] `definitions`: Symbol signatures only
- [ ] `full`: Symbols + all relationships

---

## 📝 Notes

**Tech Stack Advantage:** GitNexus runs 100% in browser (WASM). Noodlbox requires CLI daemon.

**Key Differentiator to Build:** Communities + Processes transform raw graph into actionable insights.
