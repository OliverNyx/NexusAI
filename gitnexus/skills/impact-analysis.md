---
name: gitnexus-impact-analysis
description: Analyze blast radius before making code changes
---

# Impact Analysis with GitNexus

## When to Use
- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"
- Before making non-trivial code changes

## Workflow

```
1. gitnexus_impact({target: "X", direction: "upstream"})  → What depends on this
2. READ gitnexus://repo/{name}/clusters                    → Check which areas are affected
3. READ gitnexus://repo/{name}/processes                   → Check affected execution flows
4. Assess risk and report to user
```

> If "Index is stale" → run `npx gitnexus analyze` in terminal.

## Checklist

```
- [ ] gitnexus_impact({target, direction: "upstream"}) to find dependents
- [ ] Review d=1 items first (these WILL BREAK)
- [ ] Check high-confidence (>0.8) dependencies
- [ ] READ clusters to understand which areas are affected
- [ ] Count affected clusters (cross-cutting = higher risk)
- [ ] READ processes to check affected execution flows
- [ ] Assess risk level and report to user
```

## Understanding Output

| Depth | Risk Level | Meaning |
|-------|-----------|---------|
| d=1 | **WILL BREAK** | Direct callers/importers |
| d=2 | LIKELY AFFECTED | Indirect dependencies |
| d=3 | MAY NEED TESTING | Transitive effects |

## Risk Assessment

| Affected | Risk |
|----------|------|
| <5 symbols, 1 cluster | LOW |
| 5-15 symbols, 1-2 clusters | MEDIUM |
| >15 symbols or 3+ clusters | HIGH |
| Critical path (auth, payments) | CRITICAL |

## Tools

**gitnexus_impact** — the primary tool:
```
gitnexus_impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3
})

→ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

→ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]

→ Affected Processes: LoginFlow, TokenRefresh
→ Risk: MEDIUM (3 processes)
```

## Example: "What breaks if I change validateUser?"

```
1. gitnexus_impact({target: "validateUser", direction: "upstream"})
   → d=1: loginHandler, apiMiddleware (WILL BREAK)
   → d=2: authRouter, sessionManager (LIKELY AFFECTED)

2. READ gitnexus://repo/my-app/clusters
   → Auth and API clusters affected (2 clusters)

3. Risk: 2 direct callers, 2 clusters = MEDIUM
```
