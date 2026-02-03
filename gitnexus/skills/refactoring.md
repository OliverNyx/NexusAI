---
name: gitnexus-refactoring
description: Plan safe refactors using blast radius and dependency mapping
---

# Refactoring with GitNexus

## Quick Start
1. `gitnexus_impact(target, "upstream")` → Map all dependents
2. `gitnexus_cypher` → Find all references
3. Plan changes in dependency order

## When to Use
- "Rename this function safely"
- "Extract this into a module"
- "Split this service"
- "Refactor without breaking things"

## Checklists

### Rename Symbol
```
Rename Refactoring:
- [ ] gitnexus_impact(oldName, "upstream") — find all callers
- [ ] gitnexus_search(oldName) — find string literals
- [ ] Check for reflection/dynamic references
- [ ] Update in order: interface → implementation → usages
- [ ] Run tests for affected processes
```

### Extract Module
```
Extract Module:
- [ ] gitnexus_explore(target, "symbol") — map dependencies
- [ ] gitnexus_impact(target, "upstream") — find callers
- [ ] Define new module interface
- [ ] Move code to new module
- [ ] Update imports across affected files
- [ ] Verify no circular dependencies
```

### Split Function
```
Split Function:
- [ ] gitnexus_explore(target, "symbol") — understand callees
- [ ] Group related logic
- [ ] gitnexus_impact — verify callers won't break
- [ ] Create new functions
- [ ] Update callers to use correct function
```

## Tool Reference

### Finding all references
```
gitnexus_cypher({query: `
  MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "validateUser"})
  RETURN caller.name, caller.filePath
  ORDER BY caller.filePath
`})
```

### Finding symbols by name pattern
```
gitnexus_cypher({query: `
  MATCH (s)
  WHERE s.name CONTAINS "Payment"
  RETURN s.name, labels(s)[0] AS type, s.filePath
`})
```

### Finding all imports of a module
```
gitnexus_cypher({query: `
  MATCH (importer)-[:CodeRelation {type: 'IMPORTS'}]->(f:File {name: "utils.ts"})
  RETURN importer.name, importer.filePath
`})
```

### Finding community/cluster members
```
gitnexus_cypher({query: `
  MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community {label: "Auth"})
  RETURN s.name, labels(s)[0] AS type
`})
```

## Example: Safely Rename `validateUser` to `authenticateUser`

1. **Map all callers**
   ```
   gitnexus_impact({
     target: "validateUser",
     direction: "upstream",
     minConfidence: 0.9
   })
   ```
   → loginHandler, apiMiddleware, testUtils

2. **Check for string references**
   ```
   gitnexus_search({query: "validateUser"})
   ```
   → Found in: config.json (dynamic reference!)

3. **Get affected processes**
   ```
   gitnexus_explore({name: "validateUser", type: "symbol"})
   ```
   → Processes: LoginFlow, TokenRefresh, APIGateway

4. **Plan update order**
   1. Update declaration in auth.ts
   2. Update config.json string reference
   3. Update loginHandler
   4. Update apiMiddleware
   5. Update testUtils
   6. Run: LoginFlow, TokenRefresh, APIGateway tests

## Example: Extract PaymentValidator Module

1. **Understand current dependencies**
   ```
   gitnexus_explore({name: "validatePayment", type: "symbol"})
   ```
   → Callees: verifyCard, checkAmount, fetchRates
   → Callers: processCheckout, refundHandler

2. **Map blast radius**
   ```
   gitnexus_impact({target: "validatePayment", direction: "upstream"})
   ```
   → 2 direct callers, 3 processes

3. **Create new module**
   - Move validatePayment, verifyCard, checkAmount to PaymentValidator
   - Keep fetchRates as external dependency (inject it)

4. **Update callers**
   - processCheckout: import { validatePayment } from './PaymentValidator'
   - refundHandler: import { validatePayment } from './PaymentValidator'

5. **Verify**
   - Run tests for CheckoutFlow, RefundFlow processes

## Refactoring Safety Rules

| Risk Factor | Mitigation |
|-------------|------------|
| Many callers (>5) | Update in small batches |
| Cross-cluster | Coordinate with other teams |
| String references | Search for dynamic usage |
| Reflection | Check for dynamic invocation |
| External exports | May break downstream repos |

## When to Use Something Else

| Need | Use Instead |
|------|-------------|
| Explore unfamiliar code | `gitnexus-exploring` skill |
| Debug failing code | `gitnexus-debugging` skill |
| Quick impact check | `gitnexus-impact-analysis` skill |
