---
name: gitnexus-exploring
description: Navigate unfamiliar code using GitNexus knowledge graph
---

# Exploring Codebases

## Quick Start
1. `gitnexus_context` → Get codebase stats and hotspots
2. `gitnexus_overview` → See all clusters and processes
3. `gitnexus_explore(name, "cluster")` → Deep dive on a cluster

## When to Use
- "How does authentication work?"
- "What's the project structure?"
- "Show me the main components"
- "Where is the database logic?"

## Workflow
```
Exploring Codebase:
- [ ] Call gitnexus_context to get codebase overview
- [ ] Call gitnexus_overview to list clusters
- [ ] Identify the relevant cluster by name
- [ ] Call gitnexus_explore(clusterName, "cluster") to see members
- [ ] Call gitnexus_explore(symbolName, "symbol") for specific functions
```

## Tool Reference

### gitnexus_context
Get codebase overview. **Call first.**
```
gitnexus_context()
→ Stats: 2,400 nodes, 12 clusters, 45 processes
→ Hotspots: most connected functions
```

### gitnexus_overview
List all clusters and processes.
```
gitnexus_overview({showClusters: true, showProcesses: true})
→ Clusters: Auth, Database, API, ...
→ Processes: LoginFlow, CheckoutFlow, ...
```

### gitnexus_explore
Deep dive on symbol, cluster, or process.
```
gitnexus_explore({name: "Auth", type: "cluster"})
→ Members: validateUser, checkToken, hashPassword
→ Processes using this cluster

gitnexus_explore({name: "validateUser", type: "symbol"})
→ Callers: loginHandler, apiMiddleware
→ Callees: checkToken, getUserById
→ Cluster: Auth

gitnexus_explore({name: "LoginFlow", type: "process"})
→ Steps: handleLogin → validateUser → createSession → respond
```

## Example: "How does payment processing work?"

1. **Get overview**
   ```
   gitnexus_context()
   ```
   → 2,400 nodes, 12 clusters, 45 processes

2. **Find payment cluster**
   ```
   gitnexus_overview({showClusters: true})
   ```
   → Clusters: Auth, **Payment**, Database, API, ...

3. **Explore payment cluster**
   ```
   gitnexus_explore({name: "Payment", type: "cluster"})
   ```
   → Members: processPayment, validateCard, PaymentService, ...
   → Processes: CheckoutFlow, RefundFlow

4. **Trace the checkout flow**
   ```
   gitnexus_explore({name: "CheckoutFlow", type: "process"})
   ```
   → handleCheckout → validateCart → processPayment → sendConfirmation

## When to Use Something Else

| Need | Use Instead |
|------|-------------|
| Debug failing code | `gitnexus-debugging` skill |
| Check change impact | `gitnexus-impact-analysis` skill |
| Plan refactoring | `gitnexus-refactoring` skill |
