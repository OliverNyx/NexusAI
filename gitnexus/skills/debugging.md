---
name: gitnexus-debugging
description: Trace bugs through call chains using knowledge graph
---

# Debugging with GitNexus

## Quick Start
1. `gitnexus_search(query)` → Find code related to the error
2. `gitnexus_explore(name, "symbol")` → Get callers and callees
3. `gitnexus_cypher` → Trace specific dependency paths

## When to Use
- "Why is this function failing?"
- "Trace where this error comes from"
- "Who calls this method?"
- "Debug the payment issue"

## Workflow
```
Bug Investigation:
- [ ] Understand the symptom (error message, behavior)
- [ ] gitnexus_search to find related code
- [ ] Identify the suspect function
- [ ] gitnexus_explore to see callers/callees
- [ ] Check which processes the suspect is in
- [ ] Trace dependencies with gitnexus_cypher
- [ ] Form hypothesis and verify
```

## Tool Reference

### gitnexus_search
Find code related to error or symptom.
```
gitnexus_search({
  query: "payment validation error",
  depth: "full",
  groupByProcess: true
})
→ validatePayment, handlePaymentError, PaymentException
→ Grouped by: CheckoutFlow, RefundFlow
```

### gitnexus_explore (for symbol)
Get symbol context.
```
gitnexus_explore({name: "validatePayment", type: "symbol"})
→ Callers: processCheckout, webhookHandler
→ Callees: verifyCard, fetchRates
→ Cluster: Payment
→ Processes: CheckoutFlow, RefundFlow
```

### gitnexus_cypher
Custom graph queries for tracing.

**Find all callers of a function:**
```
gitnexus_cypher({query: `
  MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "validatePayment"})
  RETURN caller.name, caller.filePath
`})
```

**Find what a function calls:**
```
gitnexus_cypher({query: `
  MATCH (f:Function {name: "validatePayment"})-[:CodeRelation {type: 'CALLS'}]->(callee)
  RETURN callee.name, callee.filePath
`})
```

**Trace call chain (2 hops):**
```
gitnexus_cypher({query: `
  MATCH path = (a)-[:CodeRelation {type: 'CALLS'}*1..2]->(b:Function {name: "validatePayment"})
  RETURN [n IN nodes(path) | n.name] AS chain
`})
```

## Example: "Payment endpoint returns 500 intermittently"

1. **Search for payment error handling**
   ```
   gitnexus_search({query: "payment error handling", depth: "full"})
   ```
   → validatePayment, handlePaymentError, PaymentException

2. **Explore the suspect function**
   ```
   gitnexus_explore({name: "validatePayment", type: "symbol"})
   ```
   → Callers: processCheckout, webhookHandler
   → Callees: verifyCard, **fetchRates** (external API!)

3. **Form hypothesis**
   `fetchRates` calls external currency API → intermittent failures when API is slow

4. **Verify**
   Read `fetchRates` source to check timeout/error handling

5. **Root cause**
   `fetchRates` doesn't handle timeout properly → fix with retry logic

## Debugging Patterns

| Symptom | Approach |
|---------|----------|
| Error message | Search for error text, trace throw sites |
| Wrong return value | Trace data flow through callees |
| Intermittent failure | Look for external calls, timeouts |
| Performance issue | Find hot paths via callers count |
| Recent regression | Check recently modified files |

## When to Use Something Else

| Need | Use Instead |
|------|-------------|
| Explore unfamiliar code | `gitnexus-exploring` skill |
| Check change impact | `gitnexus-impact-analysis` skill |
| Plan refactoring | `gitnexus-refactoring` skill |
