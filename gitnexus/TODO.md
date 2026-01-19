# GitNexus V2 Strategic Roadmap: The "Semantic Understanding" Upgrade

> **Context for Models:** This document contains a comprehensive analysis of a competitor tool ("Noodlbox") and a detailed roadmap for integrating its best features into GitNexus. GitNexus is a browser-native (WASM) code analysis tool using KuzuDB and Tree-sitter. This roadmap aims to elevate GitNexus from a "Code Graph" to a "Semantic Code Understanding" platform.

---

## 1. Competitive Analysis: GitNexus vs. Noodlbox

### Core Architecture
| Feature | GitNexus (Current) | Noodlbox (Competitor) | Advantage |
|---------|-------------------|-----------------------|-----------|
| **Runtime** | **100% Browser (WASM)**. Zero setup. Privacy-first. | **CLI + Local Server**. Requires installation/daemon. | **GitNexus** (UX/Privacy) |
| **Storage** | **KuzuDB (WASM)**. Graph + Vector. | **LanceDB**. Graph + Vector. | Tied (Both robust) |
| **Extraction** | Tree-sitter (WASM). | Tree-sitter. | Tied |
| **Integration** | Custom MCP Bridge (Browser ↔ Local). | Direct CLI MCP Server. | Noodlbox (Simpler setup) |

### Conceptual Model (The Gap)
| Feature | GitNexus | Noodlbox | Analysis |
|---------|----------|----------|----------|
| **Grouping** | File-based (Folders). | **Communities**. Algorithmic clustering of related code. | **Noodlbox**. Reveals logical architecture vs physical. |
| **Flows** | Raw `CALLS` edges. | **Processes**. Named execution paths (Entry → End). | **Noodlbox**. "How it works" vs "What calls what". |
| **Search** | Hybrid (BM25 + Vec). | Context Search. | Tied, but Noodlbox returns Processes. |
| **Impact** | Node Blast Radius. | **Git Diff Impact**. Unstaged/Staged analysis. | **Noodlbox**. Much better DevEx. |
| **UX** | Raw IDs/Filenames. | **Labels**. Human-readable names ("Auth System"). | **Noodlbox**. Cognitive load reduction. |

---

## 2. Strategic Goal: "The Graph of Meaning"
We need to move GitNexus beyond just mapping *files and functions* to mapping *concepts and flows*.
**Shift:** `Files -> Communities`, `Functions -> Processes`, `Edges -> Flows`.

---

## 3. Implementation Roadmap

### 🔥 PHASE 1: The Semantic Layer (High Priority)
*Transform the raw KuzuDB graph into high-level concepts.*

#### 1.1 Communities (Code Clusters)
**Concept:** Use modularity optimization to group tightly coupled symbols into "Communities" (e.g., "Auth System", "Payment Processing") regardless of folder structure.
*   **Algorithm:** Implement **Leiden Algorithm** (superior to Louvain for refined clusters) or **Louvain** in WASM (or pure JS if graph small enough).
*   **Trigger:** Run post-ingestion.
*   **Schema Update:**
    *   New Node: `Community { id, label, cohesionScore }`
    *   New Edge: `MEMBER_OF` (Symbol -> Community)
*   **Metrics:** Calculate **Cohesion Score** (internal edges / total edges) to rate cluster quality (0-1).
*   **Key Symbols:** Identify diverse "Entry Points" (called from outside) and "Central Hubs" (high internal degree).

#### 1.2 Processes (Execution Flows)
**Concept:** Trace and name execution paths often hidden in call graphs.
*   **Detection Heuristic:**
    1.  Find **Entry Points**: Functions called by Frameworks (e.g., `handleRequest`) or with 0 internal callers.
    2.  Trace forward `CALLS` edges (limit depth/branching).
    3.  Group linear paths.
*   **Schema Update:**
    *   New Node: `Process { id, label, process_type: 'intra'|'cross' }`
    *   New Edge: `STEP_IN_PROCESS { step_number }` (Symbol -> Process)
*   **Process Labeling:** Heuristic naming (e.g., `[EntryFn]_[Action]`).

#### 1.3 Git Diff Impact Detection
**Concept:** Analyze *work-in-progress* code, not just the committed graph.
*   **MCP Tool:** `detect_impact(scope: 'unstaged' | 'staged')`
*   **Workflow:**
    1.  MCP Client reads `git diff`.
    2.  Parse diff to find changed symbols (e.g., `src/auth.ts: function login`).
    3.  Query Graph for `potentially_affected` (Downstream callers).
    4.  **Crucial:** Map affected symbols to **Processes** and **Communities**.
    5.  Output: "Changing `login` affects 'Checkout Flow' and 'User Onboarding Process'".

---

### 🟡 PHASE 2: Cognitive UX (Medium Priority)
*Make the complex graph human-readable.*

#### 2.1 Smart Labeling
**Concept:** Replacing IDs with meaningful names.
*   **Generator:** Simple LLM pass or rule-based heuristic.
    *   Input: Top file paths in Community (e.g., `src/auth/*`, `src/login/*`).
    *   Output: Label "Authentication".
*   **Storage:** `.gitnexus/labels.json`.
*   **Usage:** UI & MCP tools display "Auth System" instead of "Community #12".

#### 2.2 Architecture Generation (`generate_map`)
**Concept:** Auto-generated documentation that stays up to date.
*   **MCP Tool:** `gitnexus_generate_architecture`
*   **Output:** `ARCHITECTURE/` folder.
    *   `README.md`: Mermaid Diagram of Communities + Cross-community data flow.
    *   `{process_name}.md`: Sequence diagrams of key processes.
*   **Value:** Instant "Onboarding Docs" for any repo.

#### 2.3 Centrality & Importance
**Concept:** Not all nodes are equal.
*   **Algorithm:** **PageRank** or **Betweenness Centrality**.
*   **Use Case:** Search results ranking. When searching "Auth", show the `AuthService` class before a random utility function used by it.

---

### 🟢 PHASE 3: Agentic Workflows (Low Priority)
*Standardized "Thinking Patterns" for the LLM.*

#### 3.1 "Skills" (Structured Prompts)
Define rigid workflows for the Agent to prevent "wandering":
*   **Exploration Skill:** `Read Map -> Pick Community -> List Key Processes -> Drill Down`.
*   **Debugging Skill:** `Error Msg -> Search Context -> Trace Backwards (Callers) -> Check Recent Changes`.
*   **Refactoring Skill:** `Select Symbol -> Blast Radius -> Dependencies (In/Out) -> Plan Split`.

#### 3.2 Hooks
*   **Session Hook:** auto-inject `database-schema` and high-level `codebase-map` at chat start.
*   **Search Hook:** Intercept `grep` in IDE to attach semantic context ("This match is part of 'Payment Process'").

---

## 4. Technical Specs & Schema Changes

### Proposed KuzuDB Schema V2

```typescript
// Nodes
interface Community {
  id: string; // "comm_1"
  label: string; // "Authentication"
  cohesion: number; // 0.85
}

interface Process {
  id: string; // "proc_login_flow"
  label: string; // "Login Flow"
  type: 'intra_community' | 'cross_community';
}

// Relationships
// MEMBER_OF: Symbol -> Community
// STEP_IN_PROCESS: Symbol -> Process (property: step_index)
```

### Algorithm Reference
*   **Leiden Algorithm:**
    *   *Input:* Adjacency matrix of `CALLS` + `EXTENDS` edges.
    *   *Output:* Partition assignment (NodeID -> CommunityID).
    *   *Constraint:* Must run fast in JS/WASM.
*   **Reciprocal Rank Fusion (RRF):**
    *   Already used for Search. Can be refined to weight "Key Symbols" (Centrality) higher.

---

## 5. Summary of Work to Be Done
1.  **Ingestion:** Add `CommunityDetection` and `ProcessTracing` post-processors.
2.  **Schema:** Add `Community` and `Process` tables.
3.  **MCP:** Add `detect_impact` tool accepting git diffs.
4.  **UI:** Visualize Communities (colored clusters) and Processes (animated paths).
5.  **Docs:** Implement `generate_map` to export findings to Markdown.
