---
name: gitnexus-debugging
description: Trace bugs through call chains using knowledge graph
---

# Debugging with GitNexus

## Quick Start
```
0. READ gitnexus://repos                          → Discover indexed repos
1. If "Index is stale" → run `npx gitnexus analyze` in terminal
2. gitnexus_search({query: "...", repo: "my-app"})  → Find code related to error
3. gitnexus_explore({name, type: "symbol", repo: "my-app"}) → Get callers and callees
4. READ gitnexus://repo/my-app/process/{name}      → Trace execution flow
```

## When to Use
- "Why is this function failing?"
- "Trace where this error comes from"
- "Who calls this method?"
- "Debug the payment issue"

## Workflow Checklist
```
Bug Investigation:
- [ ] READ gitnexus://repos to find the right repo
- [ ] Understand the symptom (error message, behavior)
- [ ] gitnexus_search to find related code
- [ ] Identify the suspect function
- [ ] gitnexus_explore to see callers/callees
- [ ] READ gitnexus://repo/{name}/process/{name} if suspect is in a process
- [ ] READ gitnexus://repo/{name}/schema for Cypher query help
- [ ] gitnexus_cypher for custom traces
```

## Resource Reference

### gitnexus://repo/{name}/schema
Graph schema for writing Cypher queries:
```yaml
nodes: [Function, Class, Method, File, Community, Process]
relationships: [CALLS, IMPORTS, EXTENDS, IMPLEMENTS, MEMBER_OF, STEP_IN_PROCESS]
example_queries:
  find_callers: |
    MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "X"})
    RETURN caller.name
```

### gitnexus://repo/{name}/process/{processName}
Trace execution flow to find where bug might occur:
```yaml
name: CheckoutFlow
trace:
  1: handleCheckout
  2: validateCart
  3: processPayment  ← bug here?
  4: sendConfirmation
```

## Tool Reference

### gitnexus_search
Find code related to error or symptom:
```
gitnexus_search({query: "payment validation error", depth: "full", repo: "my-app"})
```

### gitnexus_explore
Get symbol context:
```
gitnexus_explore({name: "validatePayment", type: "symbol", repo: "my-app"})
→ Callers: processCheckout, webhookHandler
→ Callees: verifyCard, fetchRates
```

### gitnexus_cypher
Custom graph queries for tracing:
```cypher
// Trace call chain (2 hops)
MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..2]->(b:Function {name: "validatePayment"})
RETURN [n IN nodes(path) | n.name] AS chain
```

## Example: "Payment endpoint returns 500 intermittently"

```
1. gitnexus_search({query: "payment error handling", repo: "my-app"})
   → validatePayment, handlePaymentError, PaymentException

2. gitnexus_explore({name: "validatePayment", type: "symbol", repo: "my-app"})
   → Callees: verifyCard, fetchRates (external API!)

3. READ gitnexus://repo/my-app/process/CheckoutFlow
   → Step 3: validatePayment → calls external API

4. Root cause: fetchRates calls external API without proper timeout
```

## Debugging Patterns

| Symptom | Approach |
|---------|----------|
| Error message | Search for error text, trace throw sites |
| Wrong return value | Trace data flow through callees |
| Intermittent failure | Look for external calls, timeouts |
| Performance issue | Find hot paths via callers count |
