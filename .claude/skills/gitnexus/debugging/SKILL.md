---
name: gitnexus-debugging
description: Trace bugs through call chains using knowledge graph
---

# Debugging with GitNexus

## When to Use
- "Why is this function failing?"
- "Trace where this error comes from"
- "Who calls this method?"
- "This endpoint returns 500"
- Investigating bugs, errors, or unexpected behavior

## Workflow

```
1. gitnexus_search({query: "<error or symptom>"})            → Find related code
2. gitnexus_explore({name: "<suspect>", type: "symbol"})     → See callers/callees
3. READ gitnexus://repo/{name}/process/{name}                → Trace execution flow
4. gitnexus_cypher({query: "MATCH path..."})                 → Custom traces if needed
```

> If "Index is stale" → run `npx gitnexus analyze` in terminal.

## Checklist

```
- [ ] Understand the symptom (error message, unexpected behavior)
- [ ] gitnexus_search for error text or related code
- [ ] Identify the suspect function
- [ ] gitnexus_explore to see callers and callees
- [ ] Trace execution flow via process resource if applicable
- [ ] gitnexus_cypher for custom call chain traces if needed
- [ ] Read source files to confirm root cause
```

## Debugging Patterns

| Symptom | GitNexus Approach |
|---------|-------------------|
| Error message | `gitnexus_search` for error text → `explore` throw sites |
| Wrong return value | `explore` the function → trace callees for data flow |
| Intermittent failure | `explore` → look for external calls, async deps |
| Performance issue | `explore` → find symbols with many callers (hot paths) |
| Recent regression | `gitnexus_impact` on recently changed symbols |

## Tools

**gitnexus_search** — find code related to error:
```
gitnexus_search({query: "payment validation error", depth: "full"})
→ validatePayment, handlePaymentError, PaymentException
```

**gitnexus_explore** — full context for a suspect:
```
gitnexus_explore({name: "validatePayment", type: "symbol"})
→ Callers: processCheckout, webhookHandler
→ Callees: verifyCard, fetchRates (external API!)
→ Cluster: Payment
```

**gitnexus_cypher** — custom call chain traces:
```cypher
MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..2]->(b:Function {name: "validatePayment"})
RETURN [n IN nodes(path) | n.name] AS chain
```

## Example: "Payment endpoint returns 500 intermittently"

```
1. gitnexus_search({query: "payment error handling"})
   → validatePayment, handlePaymentError, PaymentException

2. gitnexus_explore({name: "validatePayment", type: "symbol"})
   → Callees: verifyCard, fetchRates (external API!)

3. READ gitnexus://repo/my-app/process/CheckoutFlow
   → Step 3: validatePayment → calls fetchRates (external)

4. Root cause: fetchRates calls external API without proper timeout
```
