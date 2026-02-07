---
name: gitnexus-exploring
description: Navigate unfamiliar code using GitNexus knowledge graph
---

# Exploring Codebases with GitNexus

## When to Use
- "How does authentication work?"
- "What's the project structure?"
- "Show me the main components"
- "Where is the database logic?"
- Understanding code you haven't seen before

## Workflow

```
1. READ gitnexus://repos                          → Discover indexed repos
2. READ gitnexus://repo/{name}/context             → Codebase overview, check staleness
3. READ gitnexus://repo/{name}/clusters            → See all functional areas
4. READ gitnexus://repo/{name}/cluster/{name}      → Drill into relevant cluster
5. gitnexus_explore({name, type: "symbol"})        → Deep dive on specific symbol
```

> If step 2 says "Index is stale" → run `npx gitnexus analyze` in terminal.

## Checklist

```
- [ ] READ gitnexus://repos
- [ ] READ gitnexus://repo/{name}/context
- [ ] READ gitnexus://repo/{name}/clusters
- [ ] Identify the relevant cluster
- [ ] READ gitnexus://repo/{name}/cluster/{name}
- [ ] gitnexus_explore for key symbols
- [ ] Read source files for implementation details
```

## Resources

| Resource | What you get |
|----------|-------------|
| `gitnexus://repo/{name}/context` | Stats, staleness warning (~150 tokens) |
| `gitnexus://repo/{name}/clusters` | All clusters with cohesion scores (~300 tokens) |
| `gitnexus://repo/{name}/cluster/{name}` | Cluster members with file paths (~500 tokens) |
| `gitnexus://repo/{name}/process/{name}` | Step-by-step execution trace (~200 tokens) |

## Tools

**gitnexus_explore** — symbol context with callers/callees:
```
gitnexus_explore({name: "validateUser", type: "symbol"})
→ Callers: loginHandler, apiMiddleware
→ Callees: checkToken, getUserById
→ Cluster: Auth (92% cohesion)
```

**gitnexus_search** — find code by query when you don't know the cluster:
```
gitnexus_search({query: "payment validation", depth: "full"})
```

## Example: "How does payment processing work?"

```
1. READ gitnexus://repo/my-app/context       → 918 symbols, 12 clusters
2. READ gitnexus://repo/my-app/clusters       → Auth, Payment, Database, API...
3. READ gitnexus://repo/my-app/cluster/Payment → processPayment, validateCard, PaymentService
4. gitnexus_explore({name: "processPayment", type: "symbol"})
   → Callers: checkoutHandler, webhookHandler
   → Callees: validateCard, chargeStripe, saveTransaction
5. Read src/payments/processor.ts for implementation details
```
