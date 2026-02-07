---
name: gitnexus-refactoring
description: Plan safe refactors using blast radius and dependency mapping
---

# Refactoring with GitNexus

## When to Use
- "Rename this function safely"
- "Extract this into a module"
- "Split this service"
- "Move this to a new file"
- Any task involving renaming, extracting, splitting, or restructuring code

## Workflow

```
1. gitnexus_impact({target: "X", direction: "upstream"})  → Map all dependents
2. gitnexus_search({query: "X"})                           → Find string/dynamic references
3. READ gitnexus://repo/{name}/cluster/{name}              → Check cohesion impact
4. Plan update order: interfaces → implementations → callers → tests
```

> If "Index is stale" → run `npx gitnexus analyze` in terminal.

## Checklists

### Rename Symbol
```
- [ ] gitnexus_impact({target: oldName, direction: "upstream"}) — find all callers
- [ ] gitnexus_search({query: oldName}) — find string literals and dynamic references
- [ ] Check for reflection/dynamic invocation patterns
- [ ] Plan update order: interface → implementation → callers → tests
- [ ] Update all d=1 (WILL BREAK) items
- [ ] Run tests for affected processes
```

### Extract Module
```
- [ ] gitnexus_explore({name: target, type: "symbol"}) — map internal dependencies
- [ ] gitnexus_impact({target, direction: "upstream"}) — find all external callers
- [ ] READ cluster resource — check if extraction preserves cohesion
- [ ] Define new module interface
- [ ] Extract code, update imports
- [ ] Run tests for affected processes
```

### Split Function/Service
```
- [ ] gitnexus_explore({name: target, type: "symbol"}) — understand all callees
- [ ] Group callees by responsibility/domain
- [ ] gitnexus_impact({target, direction: "upstream"}) — map callers to update
- [ ] Create new functions/services
- [ ] Update callers
- [ ] Run tests for affected processes
```

## Tools

**gitnexus_impact** — map all dependents first:
```
gitnexus_impact({target: "validateUser", direction: "upstream"})
→ d=1: loginHandler, apiMiddleware, testUtils
→ Affected Processes: LoginFlow, TokenRefresh
```

**gitnexus_search** — find string/dynamic references impact() might miss:
```
gitnexus_search({query: "validateUser"})
→ Found in: config.json (dynamic reference!), test fixtures
```

**gitnexus_cypher** — custom reference queries:
```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "validateUser"})
RETURN caller.name, caller.filePath ORDER BY caller.filePath
```

## Risk Rules

| Risk Factor | Mitigation |
|-------------|------------|
| Many callers (>5) | Update in small batches |
| Cross-cluster refs | Coordinate with affected areas |
| String/dynamic refs | `gitnexus_search` to find them |
| External/public API | Version and deprecate properly |

## Example: Rename `validateUser` to `authenticateUser`

```
1. gitnexus_impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware, testUtils

2. gitnexus_search({query: "validateUser"})
   → Found in: config.json (dynamic reference!)

3. Plan update order:
   1. Update declaration in src/auth/validator.ts
   2. Update config.json string reference
   3. Update loginHandler, apiMiddleware, testUtils
   4. Run tests for LoginFlow, TokenRefresh
```
