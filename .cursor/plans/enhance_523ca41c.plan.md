---
name: Enhance
overview: Restructure GitNexus LLM tools to leverage clusters and processes for better code understanding. Remove unused highlight tool, add new tools (explore, overview), enhance existing tools with cluster/process context, and improve impact analysis reliability.
todos: []
---

# Enhanced LLM Tools with Cluster and Process Integration

## Summary

Consolidate GitNexus from 6 tools to **7 focused tools** that leverage the pre-computed clusters (Communities) and processes for richer context. Remove the highlight tool, add `explore` and `overview` tools, and enhance `search` and `blastRadius` with cluster/process awareness.

## Final Tool Set

| Tool | Status | Purpose ||------|--------|---------|| `search` | Enhance | Hybrid search + group results by process/cluster || `grep` | Keep | Regex pattern search || `read` | Keep | Read file content || `explore` | **New** | Deep dive on one symbol, cluster, or process || `overview` | **New** | Codebase map (all clusters + all processes) || `impact` | Enhance | Rename from blastRadius, add process/cluster context, increase limits || `cypher` | Keep | Raw graph queries || `highlight` | **Remove** | No longer needed |

## Architecture

```mermaid
flowchart TD
    subgraph tools [LLM Tools Layer]
        search[search]
        grep[grep]
        read[read]
        explore[explore]
        overview[overview]
        impact[impact]
        cypher[cypher]
    end
    
    subgraph graph [Knowledge Graph]
        nodes[Nodes: File, Function, Class...]
        communities[Community Nodes]
        processes[Process Nodes]
        edges[CodeRelation Edges]
        memberOf[MEMBER_OF Edges]
        stepIn[STEP_IN_PROCESS Edges]
    end
    
    search --> edges
    search --> communities
    search --> processes
    explore --> communities
    explore --> processes
    explore --> memberOf
    explore --> stepIn
    overview --> communities
    overview --> processes
    impact --> edges
    impact --> communities
    impact --> processes
    cypher --> graph
```



## File Changes

### 1. Remove Highlight Tool

**File:** [gitnexus/src/core/llm/tools.ts](gitnexus/src/core/llm/tools.ts)

- Delete the `highlightTool` definition (lines ~395-414)
- Remove `highlightTool` from the returned array (line ~862)
- Remove highlight marker logic from `blastRadius` output (line ~814-816)

**File:** [gitnexus/src/core/llm/agent.ts](gitnexus/src/core/llm/agent.ts)

- Remove highlight references from system prompt (lines 70, 77)
- Update tool list in prompt to reflect new tools

**File:** [gitnexus/src/core/llm/types.ts](gitnexus/src/core/llm/types.ts)

- Remove `'highlight'` from `AgentStreamChunk.type` union (line 180)
- Remove `highlightNodeIds` property (line 187-188)

### 2. Add `explore` Tool

**File:** [gitnexus/src/core/llm/tools.ts](gitnexus/src/core/llm/tools.ts)New tool that auto-detects target type and returns comprehensive context:

```typescript
explore({
  target: string,  // Name of symbol, cluster, or process
  type?: 'symbol' | 'cluster' | 'process'  // Optional, auto-detected
})
```

**Functionality:**

- For symbols: Query node, get MEMBER_OF cluster, get STEP_IN_PROCESS processes, get 1-hop connections
- For clusters: Query Community node, get members via MEMBER_OF, get processes that touch this cluster
- For processes: Query Process node, get steps via STEP_IN_PROCESS with step order, get clusters touched

**Cypher queries needed:**

```cypher
-- Symbol cluster membership
MATCH (s {name: $name})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
RETURN c.label, c.description

-- Symbol process participation  
MATCH (s {name: $name})-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
RETURN p.label, r.step, p.stepCount

-- Process steps in order
MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process {id: $processId})
RETURN s.name, s.filePath, r.step
ORDER BY r.step
```



### 3. Add `overview` Tool

**File:** [gitnexus/src/core/llm/tools.ts](gitnexus/src/core/llm/tools.ts)New tool that returns codebase structure:

```typescript
overview()  // No parameters
```

**Functionality:**

- Query all Community nodes with member counts
- Query all Process nodes with step counts and types
- Calculate cluster dependencies (cross-cluster CALLS)
- Identify critical paths (most connected processes)

**Output format:**

```javascript
CLUSTERS (N total):
| Cluster | Symbols | Cohesion | Description |
...

PROCESSES (N total):
| Process | Steps | Type | Clusters |
...

CRITICAL PATHS:
- LoginFlow (45 edges)
...
```



### 4. Enhance `search` Tool

**File:** [gitnexus/src/core/llm/tools.ts](gitnexus/src/core/llm/tools.ts)Modify existing search to group results by process:**Current:** Returns flat list with 1-hop connections**Enhanced:** Groups results by process, adds cluster context**Changes:**

- After hybrid search, query STEP_IN_PROCESS for each result
- Group results by process ID
- Sort processes by number of matching results (relevance)
- Add cluster label for each result via MEMBER_OF query
- Keep 1-hop connections as optional detail

**New parameter:**

```typescript
search({
  query: string,
  groupByProcess?: boolean,  // Default: true
  limit?: number
})
```



### 5. Enhance `impact` Tool (rename from blastRadius)

**File:** [gitnexus/src/core/llm/tools.ts](gitnexus/src/core/llm/tools.ts)**Rename:** `blastRadiusTool` to `impactTool`**Enhancements:**

1. Increase LIMIT clauses: 100 to 300 (depth 1), 100 to 200 (depth 2), 50 to 100 (depth 3)
2. Add affected processes section (query STEP_IN_PROCESS for all affected symbols)
3. Add affected clusters section (query MEMBER_OF for all affected symbols)
4. Add risk assessment summary
5. Surface confidence scores more prominently (group by confidence level)

**New output sections:**

```javascript
AFFECTED PROCESSES:
- LoginFlow - BROKEN at step 2
- SignupFlow - BROKEN at step 1

AFFECTED CLUSTERS:
- Authentication (direct)
- API Routes (indirect)

RISK: CRITICAL
- N direct callers
- N processes affected
- N clusters affected
```



### 6. Increase Process Detection Limits

**File:** [gitnexus/src/core/ingestion/process-processor.ts](gitnexus/src/core/ingestion/process-processor.ts)Change default config (lines 27-32):

```typescript
const DEFAULT_CONFIG: ProcessDetectionConfig = {
  maxTraceDepth: 10,    // Keep
  maxBranching: 4,      // Was 3
  maxProcesses: 75,     // Was 50
  minSteps: 2,          // Keep
};
```



### 7. Update System Prompt

**File:** [gitnexus/src/core/llm/agent.ts](gitnexus/src/core/llm/agent.ts)Update BASE_SYSTEM_PROMPT to reflect new tools:

```javascript
## TOOLS
- **search** - Hybrid search. Results grouped by process with cluster context.
- **grep** - Regex pattern search for exact strings.
- **read** - Read file content.
- **explore** - Deep dive on a symbol, cluster, or process. Shows membership, participation, connections.
- **overview** - Codebase map showing all clusters and processes.
- **impact** - Impact analysis. Shows affected processes, clusters, and risk level.
- **cypher** - Raw Cypher queries against the graph.

## GRAPH SCHEMA
Nodes: File, Folder, Function, Class, Interface, Method, Community, Process
Relations: CodeRelation with type: CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS, MEMBER_OF, STEP_IN_PROCESS
```



## Implementation Order

1. Remove highlight tool (cleanup)
2. Increase process detection limits
3. Add overview tool (simplest new tool)
4. Add explore tool
5. Enhance impact tool