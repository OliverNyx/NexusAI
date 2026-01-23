# GitNexus V2: Semantic Code Intelligence Roadmap

> **Last Updated:** January 2026  
> **Vision:** Transform GitNexus from a "Code Graph" into a "Semantic Code Understanding" platform that rivals and surpasses tools like Noodlbox and DeepWiki.

---

## Executive Summary

### Current State
- ✅ Tree-sitter parsing → AST extraction
- ✅ KuzuDB (WASM) → Graph + Vector storage
- ✅ Hybrid search (BM25 + Semantic)
- ✅ LangChain Agent with tools (search, cypher, grep, read, blastRadius, highlight)
- ✅ MCP integration for external AI tools

### Target State
- 🎯 **Communities:** Auto-detected code clusters (Leiden algorithm)
- 🎯 **Processes:** Named execution flows with ordered steps
- 🎯 **Hierarchical Navigation:** Codebase → Community → Process → Symbol
- 🎯 **Auto-Documentation:** Generate ARCHITECTURE/ docs from graph
- 🎯 **Incremental Updates:** File watch + delta graph updates
- 🎯 **Git Diff Impact:** Pre-commit blast radius on uncommitted changes

---

## Competitive Analysis

### vs Noodlbox
| Feature | Noodlbox | GitNexus (Current) | GitNexus (Planned) |
|---------|----------|-------------------|-------------------|
| Runtime | CLI + Server | Browser (WASM) ✅ | Browser (WASM) ✅ |
| Communities | Leiden clusters ✅ | ❌ | ✅ Planned |
| Processes | Named flows ✅ | ❌ | ✅ Planned |
| Git Diff Impact | ✅ | ❌ | ✅ Planned |
| Privacy | Local server | 100% Browser ✅ | 100% Browser ✅ |

### vs OpenDeepWiki
| Feature | OpenDeepWiki | GitNexus (Planned) |
|---------|--------------|-------------------|
| Structure Discovery | LLM guesses from files | Leiden from actual relationships ✅ |
| Process Understanding | None (file-by-file) | Static analysis traces ✅ |
| Grounding | File references only | Graph edges + files ✅ |
| "What breaks if X changes" | Cannot answer | blastRadius ✅ |

**Our Advantage:** Real graph-based understanding vs LLM inference.

---

## Phase-Wise Implementation Plan

---

## PHASE 1: Community Detection (Leiden Algorithm)
**Goal:** Group related code into named clusters.

### 1.1 Research & Setup
- [ ] Research JS/WASM implementations of Leiden algorithm
  - Options: `graphology-communities-louvain`, custom WASM port
  - Constraint: Must run in browser
- [ ] Benchmark on sample codebases (100, 1K, 10K nodes)

### 1.2 Schema Updates
- [ ] Add `Community` node table to KuzuDB schema:
  ```typescript
  interface Community {
    id: string;           // "comm_a7f3x2"
    label: string;        // "Authentication" (heuristic or LLM)
    cohesion: number;     // 0.0 - 1.0
    symbolCount: number;  // Count of symbols in community
  }
  ```
- [ ] Add `MEMBER_OF` relationship type to `CodeRelation`:
  ```typescript
  // Symbol -> Community
  { type: 'MEMBER_OF', source: symbolId, target: communityId }
  ```

### 1.3 Ingestion Pipeline Update
- [ ] Create `community-processor.ts` in `src/core/ingestion/`
- [ ] Add Phase 6 to pipeline (after heritage processing):
  ```typescript
  // pipeline.ts
  await processCommunities(graph, onProgress);
  ```
- [ ] Implement Leiden on the CALLS + IMPORTS adjacency matrix
- [ ] Generate heuristic labels (folder name majority)

### 1.4 Agent Integration
- [ ] Add `listCommunities` tool or resource
- [ ] Update system prompt to teach agent about communities
- [ ] Update `search` tool to return community context

### 1.5 UI Updates
- [ ] Color nodes by community in graph visualization
- [ ] Add community filter/legend panel

**Estimated Effort:** 2-3 weeks

---

## PHASE 2: Process Detection (Execution Flows)
**Goal:** Trace and name execution paths.

### 2.1 Schema Updates
- [ ] Add `Process` node table to KuzuDB schema:
  ```typescript
  interface Process {
    id: string;           // "proc_login_flow"
    label: string;        // "User Login Flow"
    type: 'intra_community' | 'cross_community';
    stepCount: number;
  }
  ```
- [ ] Add `STEP_IN_PROCESS` relationship type:
  ```typescript
  // Symbol -> Process (with step property)
  { type: 'STEP_IN_PROCESS', source: symbolId, target: processId, step: number }
  ```

### 2.2 Process Detection Algorithm
- [ ] Create `process-processor.ts` in `src/core/ingestion/`
- [ ] Implement entry point detection:
  ```typescript
  // Functions with no internal callers
  MATCH (f:Function) 
  WHERE NOT (:Function)-[:CALLS]->(f) 
  RETURN f
  ```
- [ ] Implement forward tracing (BFS/DFS from entry points)
- [ ] Limit depth (e.g., 10) and branching (e.g., 3)
- [ ] Deduplicate overlapping paths
- [ ] Label processes (heuristic: `{entry}_to_{terminal}`)

### 2.3 Community Integration
- [ ] Track which communities each process touches
- [ ] Mark `type` as `cross_community` if > 1 community

### 2.4 Agent Integration
- [ ] Add `listProcesses(communityId?)` tool
- [ ] Add `traceProcess(processId)` tool
- [ ] Update system prompt with process navigation

### 2.5 UI Updates
- [ ] Visualize processes as highlighted paths
- [ ] Add process list panel
- [ ] Click process → animate the flow

**Estimated Effort:** 2 weeks

---

## PHASE 3: Smart Labeling (LLM Enhancement)
**Goal:** Human-readable names for Communities and Processes.

### 3.1 Heuristic Labeling (Default)
- [ ] Community: Most common folder prefix
- [ ] Process: `{entryFunction}_to_{terminalFunction}`

### 3.2 LLM Labeling (Optional Enhancement)
- [ ] Create `labeling-service.ts`
- [ ] Batch communities/processes for LLM naming
- [ ] Prompt template:
  ```
  Given these functions: login, validateToken, checkExpiry, refreshSession
  All in folder: src/auth/
  Generate a 2-3 word label for this code cluster.
  ```
- [ ] Store both `heuristicLabel` and `llmLabel`
- [ ] Use `llmLabel` if available, else `heuristicLabel`

### 3.3 Labels File Export
- [ ] Generate `.gitnexus/labels.json` on demand
- [ ] Format matching Noodlbox for familiarity

**Estimated Effort:** 1 week

---

## PHASE 4: Architecture Documentation Generation
**Goal:** Auto-generate project documentation from graph.

### 4.1 Documentation Structure
- [ ] Output: `ARCHITECTURE/` folder
  ```
  ARCHITECTURE/
  ├── README.md              # Overview + Mermaid diagram
  ├── communities/
  │   ├── authentication.md  # Community detail
  │   └── payments.md
  └── processes/
      ├── user-login-flow.md # Process trace
      └── checkout-flow.md
  ```

### 4.2 Implementation
- [ ] Create `generate-docs.ts` in `src/core/docs/`
- [ ] README.md generation:
  - Codebase stats (files, symbols, communities, processes)
  - Mermaid diagram of community relationships
  - List of key processes
- [ ] Community doc generation:
  - Key symbols (highest centrality)
  - Entry points
  - Processes in this community
- [ ] Process doc generation:
  - Ordered step list with file paths
  - Mermaid sequence diagram
  - Cross-community markers

### 4.3 MCP Tool
- [ ] Add `generateArchitecture` tool to MCP
- [ ] Returns generated markdown (or writes to files)

**Estimated Effort:** 2 weeks

---

## PHASE 5: Git Diff Impact Detection
**Goal:** Pre-commit blast radius analysis.

### 5.1 MCP Server Updates
- [ ] Add `detectImpact` tool to `gitnexus-mcp`
- [ ] Parameters:
  ```typescript
  interface DetectImpactParams {
    scope: 'unstaged' | 'staged' | 'all' | 'compare';
    baseRef?: string;  // For 'compare' scope
  }
  ```

### 5.2 Implementation
- [ ] Run `git diff` (MCP server side)
- [ ] Parse diff to extract changed file paths + line ranges
- [ ] Map changes to symbols in graph
- [ ] Run `blastRadius` on each changed symbol
- [ ] Aggregate results by:
  - Changed symbols
  - Impacted processes
  - Affected communities
  - Risk level (low/medium/high)

### 5.3 Response Format
```typescript
interface ImpactResult {
  changedSymbols: { name: string; file: string; changeType: 'added' | 'modified' | 'deleted' }[];
  impactedProcesses: { id: string; label: string; affectedSteps: number[] }[];
  affectedCommunities: string[];
  riskLevel: 'low' | 'medium' | 'high';
}
```

**Estimated Effort:** 1-2 weeks

---

## PHASE 6: Incremental Updates (File Watch)
**Goal:** Real-time graph updates on file changes.

### 6.1 File Watching
- [ ] Integrate file system watcher in MCP server
- [ ] Detect: added, modified, deleted files
- [ ] Debounce rapid changes (e.g., 500ms)

### 6.2 Incremental Parsing
- [ ] Hash-based cache: file path → content hash → AST
- [ ] On change: re-parse only changed file
- [ ] Compute delta: added/removed nodes and edges

### 6.3 Graph Patching
- [ ] Add `patchGraph` method to KuzuDB adapter
- [ ] Operations: ADD_NODE, REMOVE_NODE, ADD_EDGE, REMOVE_EDGE
- [ ] Update affected communities (optional: re-run Leiden locally)
- [ ] Update affected processes (re-trace from changed symbols)

### 6.4 Re-embedding
- [ ] Re-embed changed symbols
- [ ] Re-embed 1-hop neighbors (context changed)

**Estimated Effort:** 2-3 weeks

---

## PHASE 7: Agent Prompt Refinement
**Goal:** Teach agent to use hierarchical navigation.

### 7.1 System Prompt Updates
- [ ] Add "Hierarchical Navigation Protocol":
  ```
  1. Query codebase map (communities overview)
  2. Identify relevant community
  3. List processes in that community
  4. Trace specific process
  5. Read code for specific steps
  ```
- [ ] Add tool descriptions for new tools

### 7.2 Skills (Optional)
- [ ] Create structured prompts for common tasks:
  - Exploration: "How does X work?"
  - Debugging: "Why is X failing?"
  - Refactoring: "What breaks if I change X?"
  - Documentation: "Generate docs for X"

**Estimated Effort:** 1 week

---

## Implementation Priority Order

| Phase | Name | Priority | Effort | Dependency |
|-------|------|----------|--------|------------|
| 1 | Communities (Leiden) | 🔴 Critical | 2-3 weeks | None |
| 2 | Processes | 🔴 Critical | 2 weeks | Phase 1 |
| 3 | Smart Labeling | 🟡 Medium | 1 week | Phase 1, 2 |
| 4 | Documentation | 🟡 Medium | 2 weeks | Phase 1, 2 |
| 5 | Git Diff Impact | 🟡 Medium | 1-2 weeks | None (uses existing blastRadius) |
| 6 | Incremental Updates | 🟢 Nice-to-have | 2-3 weeks | None |
| 7 | Agent Prompt | 🟡 Medium | 1 week | Phase 1, 2 |

**Recommended order:** 1 → 2 → 7 → 3 → 4 → 5 → 6

---

## Technical Notes

### Leiden Algorithm Options
1. **graphology-communities-louvain** (JS, works in browser)
2. **Custom WASM port** (if performance needed)
3. **Simple Louvain** might be sufficient for V1

### Schema Summary (New Additions)
```
NEW NODES:
  - Community { id, label, cohesion, symbolCount }
  - Process { id, label, type, stepCount }

NEW RELATIONSHIPS (in CodeRelation):
  - MEMBER_OF: Symbol → Community
  - STEP_IN_PROCESS: Symbol → Process (with step property)
```

### Graph Visualization Color Scheme
```
Community colors (auto-assigned):
  - Auth: Blue
  - Data: Green
  - API: Orange
  - Payment: Purple
  - ... (cyclic palette)
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Agent query accuracy | ~70% | 90%+ |
| Context tokens per query | High (dump everything) | Low (hierarchical zoom) |
| Documentation quality | N/A | Comparable to DeepWiki |
| Update latency | Full re-ingest (minutes) | Incremental (seconds) |

---

## Next Steps

1. **Immediate:** Research Leiden implementations for browser
2. **Week 1-2:** Implement Phase 1 (Communities)
3. **Week 3-4:** Implement Phase 2 (Processes)
4. **Week 5:** Refine agent prompt (Phase 7)
5. **Week 6+:** Documentation generation & polish
