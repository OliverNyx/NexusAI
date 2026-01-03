# GitNexus V2 - Client-Side Knowledge Graph Generator

> Privacy-focused, zero-server knowledge graph generator that runs entirely in your browser.

Transform codebases into interactive knowledge graphs using AST parsing, Web Workers, and an embedded KuzuDB WASM database. All processing happens locally - your code never leaves your machine. Next step -> settng up AI Layer : An embedings pipeline using a very small embedings model that can run in browser and a Graph RAG tool using LLMs to generate and execute cyfer queries. Aiming to give rich and complete retrieved context enabling Agent to detect unused code, perform security audits, do a BLAST RADIUS analyses of code changes and for overall codebase understanding and explaination.




https://github.com/user-attachments/assets/f375b00a-78cd-4f93-a96c-9ba924455f49




---

## 🚧 Current Work in Progress

**Actively Building:**

- [ ] **Graph RAG Agent** - AI chat with Cypher query generation for intelligent code exploration
- [ ] **Browser Embeddings** - Small embedding model (e.g., gte-small) for semantic node search + LLM-driven RAG
- [ ] **Multi-Worker Pool** - Parallel parsing across multiple Web Workers (currently using single worker)
- [ ] **Ollama Support** - Local LLM integration
- [ ] **CSV Export** - Export node/relationship tables

---

## ⚡ What's New in V2

V2 is a major refactor focused on **performance** and **scalability**. Here's what changed and why it matters:

### 🎨 Sigma.js Replaces D3.js (10,000+ nodes without breaking a sweat)

V1 used D3.js force simulation which worked great for small graphs, but started choking around 2-3k nodes. The browser would freeze, fans would spin, and you'd be staring at a loading spinner.

**V2 uses Sigma.js with WebGL rendering.** This means the GPU does the heavy lifting instead of JavaScript. We've tested graphs with 10k+ nodes and they render smoothly. Pan, zoom, click - all buttery smooth.

The layout algorithm also moved to **ForceAtlas2 running in a Web Worker**, so your UI stays responsive while the graph positions itself.

### 🗂️ Dual HashMap Symbol Table (Goodbye Trie, Hello Speed)

In V1, we used a **Trie** (prefix tree) to store function/class definitions. It was clever - you could do fuzzy lookups and autocomplete. But it was also slow and memory-hungry for large codebases.

V2 uses a simpler but faster **Dual HashMap** approach:

```
File-Scoped Index:  Map<FilePath, Map<SymbolName, NodeID>>
Global Index:       Map<SymbolName, SymbolDefinition[]>
```

**Why two maps?** When resolving a function call like `handleAuth()`, we first check if it's defined in a file we imported (high confidence). If not, we check the current file. As a last resort, we search globally (useful for framework magic like FastAPI's `@app.get` decorators where the connection isn't explicit in imports).

This change alone gave us **~2x speedup** on the parsing phase.

### 💾 LRU Cache for AST Trees (Memory That Cleans Itself)

Tree-sitter generates AST (Abstract Syntax Tree) objects that live in WASM memory. In V1, we'd keep all of them around, which meant memory usage grew linearly with file count. Parse 5000 files? That's 5000 AST objects eating RAM.

V2 uses an **LRU (Least Recently Used) cache** with a cap of 50 entries. When we need to parse file #51, the oldest unused AST gets evicted and we call `tree.delete()` to free the WASM memory.

The clever part: we parse files in Phase 3, then reuse those ASTs in Phase 4 (imports) and Phase 5 (calls). The LRU cache keeps recently-parsed files hot, so we rarely need to re-parse.

### 📊 Overall Results

| Metric               | V1                    | V2                  | Improvement |
| -------------------- | --------------------- | ------------------- | ----------- |
| Max renderable nodes | ~3,000                | 10,000+             | ~3x+        |
| Parse speed          | Baseline              | 3-5x faster         | ⚡          |
| Memory usage         | Grows unbounded       | Capped by LRU       | Stable      |
| UI responsiveness    | Freezes during layout | Smooth (Web Worker) | ✅          |

**Note:** V2 currently uses a single Web Worker. Multi-worker support is planned and should give another 2-4x speedup on multi-core machines.

---

## Project Focus

- **Privacy-first**: Zero-cost, zero-server tool to create knowledge graphs from codebases entirely within the browser
- **Human + AI friendly**: Knowledge graphs useful for both manual exploration and AI agent context retrieval
- **Fast & cheap**: Browser-based indexing is faster and cheaper than embedding models + vector RAG
- **Understanding codebases**: Graph visualization + Graph RAG chatbot for accurate context retrieval

## AI Use Cases

- **Blast radius analysis**: Compute impact of function/module changes, enumerate affected endpoints/tests
- **Fault isolation**: Start from a failing symbol, traverse callers/callees to isolate the fault line faster than grep or embeddings
- **Code health**: Detect orphaned nodes, unresolved imports, unused functions with simple graph queries
- **Auditing**: Spot forbidden dependencies or layer violations quickly during onboarding or security reviews

---

## Features

**Code Analysis**

- Analyze ZIP files containing codebases
- TypeScript, JavaScript, Python support
- Interactive WebGL graph visualization with Sigma.js
- Real-time Cypher queries against in-browser graph database

**Processing**

- 5-phase pipeline: Extract → Structure → Parsing → Imports → Calls
- Web Worker offloading (single worker, multi-worker planned)
- Tree-sitter WASM for AST parsing
- LRU cache with automatic WASM memory cleanup

**Privacy**

- 100% client-side - no server, no uploads
- API keys stored in localStorage only
- Open source and auditable

---

## Architecture

### V1 vs V2 Comparison

| Aspect        | V1                                | V2                                   |
| ------------- | --------------------------------- | ------------------------------------ |
| Code Style    | Class-based                       | Function-based (factory pattern)     |
| Symbol Lookup | Trie data structure               | Dual HashMap (file-scoped + global)  |
| Visualization | D3.js force simulation            | Sigma.js + WebGL + ForceAtlas2       |
| Workers       | Worker pool with Comlink          | Single worker (multi-worker planned) |
| AI Pipeline   | LangChain ReAct agents            | Not yet implemented (WIP)            |
| Layout        | D3 force simulation (main thread) | ForceAtlas2 (Web Worker)             |

### System Overview

```mermaid
graph TB
    subgraph MainThread[Main Thread]
        UI[React UI]
        CTX[AppState Context]
        SIGMA[Sigma.js WebGL]
    end

    subgraph WorkerThread[Web Worker]
        PIPE[Ingestion Pipeline]
        KUZU[KuzuDB WASM]
        TS[Tree-sitter WASM]
    end

    UI --> CTX
    CTX --> SIGMA
    PIPE --> TS
    PIPE --> KUZU
    MainThread -.-> WorkerThread
```

Think of it like this: the main thread handles what you see (React UI, graph rendering), while the Web Worker does all the heavy computation (parsing, database queries) in the background. They communicate through Comlink, which makes calling worker functions feel like regular async calls.

### Data Flow

```mermaid
flowchart LR
    ZIP[ZIP File] --> EXTRACT[Extract]
    EXTRACT --> STRUCT[Structure]
    STRUCT --> PARSE[Parse]
    PARSE --> IMPORT[Imports]
    IMPORT --> CALLS[Calls]
    CALLS --> GRAPH[Graph]
    GRAPH --> VIZ[Sigma.js]
    GRAPH --> KUZU[(KuzuDB)]
```

---

## 5-Phase Ingestion Pipeline

Here's what happens when you drop a ZIP file:

```mermaid
flowchart TD
    START([ZIP File]) --> P1
  
    subgraph P1[Phase 1: Extract - 0-15%]
        E1[Decompress ZIP]
        E2[Collect file paths]
    end
  
    subgraph P2[Phase 2: Structure - 15-30%]
        S1[Build folder tree]
        S2[Create CONTAINS edges]
    end
  
    subgraph P3[Phase 3: Parsing - 30-70%]
        PA1[Load Tree-sitter grammar]
        PA2[Generate ASTs]
        PA3[Extract symbols]
        PA4[Populate Symbol Table]
    end
  
    subgraph P4[Phase 4: Imports - 70-82%]
        I1[Find import statements]
        I2[Resolve paths]
        I3[Create IMPORTS edges]
    end
  
    subgraph P5[Phase 5: Calls - 82-100%]
        C1[Find function calls]
        C2[Resolve targets]
        C3[Create CALLS edges]
    end
  
    P1 --> P2 --> P3 --> P4 --> P5
    P5 --> DONE([Knowledge Graph Ready])
```

### What Each Phase Does

**Phase 1: Extract** - We use JSZip to decompress your ZIP file and store all file contents in a Map. Simple but necessary.

**Phase 2: Structure** - We walk through all file paths and build a tree of folders and files. A path like `src/components/Button.tsx` creates nodes for `src`, `components`, and `Button.tsx` with `CONTAINS` relationships connecting them.

**Phase 3: Parsing** - This is where the magic happens. Tree-sitter parses each file into an AST, and we extract all the interesting bits: functions, classes, interfaces, methods. These get stored in our Symbol Table for later lookup.

**Phase 4: Imports** - We find all `import` and `require` statements and figure out which files they point to. `import { foo } from './utils'` might resolve to `./utils.ts`, `./utils/index.ts`, etc. We try common extensions until we find a match.

**Phase 5: Calls** - The trickiest phase. We find all function calls and try to figure out what they're calling. We use our resolution strategy (import map → local → global) to link calls to their definitions.

---

## Symbol Resolution: How We Link Function Calls

When we see code like this:

```typescript
import { validateUser } from './auth';

function login() {
  validateUser(email, password);  // ← What does this call?
}
```

We need to figure out that `validateUser()` refers to the function defined in `./auth.ts`. Here's our strategy:

```mermaid
flowchart TD
    CALL[Found: validateUser] --> CHECK1
  
    CHECK1{In Import Map?}
    CHECK1 -->|Yes| FOUND1[Check auth.ts symbols]
    CHECK1 -->|No| CHECK2
  
    CHECK2{In Current File?}
    CHECK2 -->|Yes| FOUND2[Use local definition]
    CHECK2 -->|No| CHECK3
  
    CHECK3{Global Search}
    CHECK3 -->|Found| FOUND3[Use first match]
    CHECK3 -->|Not Found| SKIP[Skip this call]
  
    FOUND1 --> DONE[Create CALLS edge]
    FOUND2 --> DONE
    FOUND3 --> DONE
```

**Why the global fallback?** Some frameworks use "magic" that doesn't show up in imports. For example, FastAPI:

```python
@app.get("/users")
def get_users():
    return db.query(User)  # Where does 'db' come from?
```

The `db` object might be injected by the framework, not explicitly imported. Our global search catches these cases (with lower confidence).

---

## LRU AST Cache

Parsing files into ASTs is expensive, and AST objects live in WASM memory (which doesn't get garbage collected like regular JS objects). We use an LRU cache to keep memory bounded:

```mermaid
flowchart LR
    subgraph Cache[LRU Cache - 50 slots]
        HOT[Recently Used ASTs]
        COLD[Oldest ASTs]
    end
  
    NEW[New AST] -->|set| HOT
    COLD -->|evicted| DELETE[tree.delete - frees WASM memory]
  
    REQUEST[Need AST] -->|get| HOT
```

**How it helps:**

- Phase 3 parses files and stores ASTs in cache
- Phase 4 & 5 reuse cached ASTs (no re-parsing!)
- If cache is full, oldest AST is evicted and WASM memory is freed
- Result: Memory stays bounded even for huge codebases

---

## Graph Visualization

### Sigma.js + ForceAtlas2

```mermaid
flowchart LR
    subgraph Main[Main Thread]
        SIGMA[Sigma.js]
        WEBGL[WebGL Canvas]
    end
  
    subgraph Layout[Layout Worker]
        FA2[ForceAtlas2]
    end
  
    GRAPH[Graphology Graph] --> FA2
    FA2 -->|positions| GRAPH
    GRAPH --> SIGMA
    SIGMA --> WEBGL
```

**Why this combo works:**

- **Sigma.js** uses WebGL to render nodes/edges on the GPU - handles 10k+ nodes easily
- **ForceAtlas2** is a physics-based layout that runs in a Web Worker - UI stays responsive
- **Graphology** is the data structure holding the graph - fast lookups and updates

**Visual features:**

- Nodes sized by type (folders bigger than files, files bigger than functions)
- Edges colored by relationship (green for CONTAINS, blue for IMPORTS, purple for CALLS)
- Click a node to highlight its connections
- Pan/zoom with mouse, reset view button

---

## KuzuDB Integration

We load the graph into KuzuDB (an embedded graph database) so you can run Cypher queries:

```mermaid
flowchart TD
    GRAPH[Knowledge Graph] --> CSV[Generate CSV]
    CSV --> COPY[COPY FROM bulk load]
    COPY --> KUZU[(KuzuDB WASM)]
    QUERY[Cypher Query] --> KUZU
    KUZU --> RESULTS[Query Results]
```

**Example queries you can run:**

```cypher
-- Find all functions in a file
MATCH (f:CodeNode {label: 'File', name: 'App.tsx'})-[:CodeRelation]->(fn:CodeNode {label: 'Function'})
RETURN fn.name

-- Find what imports a specific file
MATCH (f:CodeNode)-[r:CodeRelation {type: 'IMPORTS'}]->(target:CodeNode {name: 'utils.ts'})
RETURN f.name
```

**Status:**

- ✅ KuzuDB WASM initialization
- ✅ Polymorphic schema (single node/edge tables)
- ✅ CSV generation and bulk loading
- ✅ Cypher query execution
- 🚧 Graph RAG agent (WIP)

---

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS v4
- **Visualization**: Sigma.js + Graphology + ForceAtlas2 (WebGL)
- **Parsing**: Tree-sitter WASM (TypeScript, JavaScript, Python)
- **Database**: KuzuDB WASM (in-browser graph database)
- **Concurrency**: Web Worker + Comlink
- **Caching**: lru-cache with WASM memory management

---

## Graph Schema

### Node Types

| Label         | Description          | Example            |
| ------------- | -------------------- | ------------------ |
| `Folder`    | Directory in project | `src/components` |
| `File`      | Source code file     | `App.tsx`        |
| `Function`  | Function definition  | `handleClick`    |
| `Class`     | Class definition     | `UserService`    |
| `Interface` | Interface definition | `Props`          |
| `Method`    | Class method         | `render`         |

### Relationship Types

| Type         | From   | To                  | Description         |
| ------------ | ------ | ------------------- | ------------------- |
| `CONTAINS` | Folder | File/Folder         | Directory structure |
| `DEFINES`  | File   | Function/Class/etc. | Code definitions    |
| `IMPORTS`  | File   | File                | Module dependencies |
| `CALLS`    | File   | Function/Method     | Function call graph |

---

## Getting Started

**Prerequisites**: Node.js 18+

```bash
git clone <repository-url>
cd gitnexus
npm install
npm run dev
```

Open http://localhost:5173

**Usage:**

1. Drag & drop a ZIP file containing your codebase
2. Wait for the 5-phase pipeline to complete
3. Explore the interactive graph
4. Click nodes to view code, filter by type, adjust depth

---

## Planned: AI Features

### Graph RAG Agent (WIP)

The idea: ask questions in plain English, get answers backed by graph queries.

```mermaid
flowchart LR
    USER[Your Question] --> LLM[LLM]
    LLM --> TOOLS[Pick a Tool]
    TOOLS --> CYPHER[Run Cypher]
    TOOLS --> SEARCH[Semantic Search]
    CYPHER --> CONTEXT[Gather Context]
    SEARCH --> CONTEXT
    CONTEXT --> LLM
    LLM --> ANSWER[Your Answer]
```

**Example interactions:**

- "What functions call `handleAuth`?" → Generates Cypher, returns list
- "Show me the blast radius if I change `UserService`" → Traverses dependencies
- "Find all files that import from `utils/`" → Pattern matching query

**Why pre-built query templates?** LLMs are... creative with Cypher syntax. Instead of letting the LLM generate queries from scratch (and fail half the time), we're building a library of reliable query templates that the LLM can choose from and fill in.

---

## Security & Privacy

- All processing happens in your browser
- No code uploaded to any server
- API keys stored in localStorage only
- Open source - audit the code yourself

---

## Deployment

```bash
npm run build
npm run preview
```

The build outputs to `dist/` and can be served from any static hosting.

---

## License

MIT License

---

## Acknowledgments

- [Tree-sitter](https://tree-sitter.github.io/) - AST parsing
- [KuzuDB](https://kuzudb.com/) - Embedded graph database
- [Sigma.js](https://www.sigmajs.org/) - WebGL graph rendering
- [Graphology](https://graphology.github.io/) - Graph data structure
- [code-graph-rag](https://github.com/vitali87/code-graph-rag) - Reference implementation
