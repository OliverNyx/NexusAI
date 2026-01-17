# GitNexus Agent Guidelines

This document describes how to use GitNexus MCP tools effectively for code understanding.

## Quick Reference

| Tool | Use When | Example |
|------|----------|---------|
| `search` | Finding code by meaning | "user authentication flow" |
| `cypher` | Traversing relationships | Finding what calls a function |
| `blastRadius` | Before refactoring | What depends on this class? |
| `context` | Understanding project | Get overview, hotspots |
| `grep` | Exact pattern match | Find all TODO comments |
| `read` | Reading file content | View actual code |
| `highlight` | Visual feedback | Show user what you found |

## Tool Details

### search(query, limit?)
Semantic search using embeddings. Understands meaning, not just keywords.

**Good for:**
- "error handling middleware"
- "database connection pooling"
- "form validation logic"

**Returns:** Array of matching nodes with id, name, type, filePath, score

---

### cypher(query)
Direct graph queries using Cypher syntax. Use for relationship traversal.

**Node Tables:** File, Folder, Function, Class, Interface, Method, CodeElement

**Relation Types:** CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS

**Example Queries:**
```cypher
-- Find functions called by a specific function
MATCH (f:Function {name: 'handleRequest'})-[:CodeRelation {type:'CALLS'}]->(called)
RETURN called.name, called.filePath

-- Find class hierarchy
MATCH (c:Class)-[:CodeRelation {type:'EXTENDS'}*1..3]->(parent)
RETURN c.name, collect(parent.name) as ancestors
```

---

### blastRadius(nodeId, hops?)
Find all nodes within N hops of a starting node.

**Use before:** Renaming, refactoring, deleting code

---

### context()
Get project overview including:
- File/function/class counts
- Hotspots (most connected nodes)
- Folder tree in TOON format

**Use first** when starting work on unfamiliar project.

---

### grep(pattern, caseSensitive?, maxResults?)
Regex search across file contents.

**Faster than search** for exact patterns like:
- `TODO`, `FIXME`, `HACK`
- Specific function calls
- Import statements

---

### read(filePath, startLine?, endLine?)
Read file content. Use after finding files via search/grep.

---

## Workflow Recommendations

### New to a Project
1. Run `context` to see structure and hotspots
2. Use `search` to find relevant areas
3. Use `read` to examine actual code

### Before Refactoring
1. Find the node: `search("function to refactor")`
2. Check impact: `blastRadius(nodeId, 2)`
3. Review callers via `cypher`

### Debugging
1. Use `grep` to find error patterns
2. Use `cypher` to trace call chain to error
3. Use `read` to examine suspicious code
