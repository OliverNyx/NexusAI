---
name: gitnexus-impact-analysis
description: Analyze blast radius before making code changes
---

# Impact Analysis

## Quick Start
```
0. READ gitnexus://repos                                    → Discover indexed repos
1. If "Index is stale" → run `npx gitnexus analyze` in terminal
2. gitnexus_impact({target, direction: "upstream", repo: "my-app"}) → What depends on this
3. READ gitnexus://repo/my-app/clusters                     → Check affected areas
4. READ gitnexus://repo/my-app/processes                    → Affected execution flows
```

## When to Use
- "Is it safe to change this function?"
- "What will break if I modify X?"
- "Show me the blast radius"
- "Who uses this code?"

## Understanding Output

| Depth | Risk Level | Meaning |
|-------|-----------|---------|
| d=1 | WILL BREAK | Direct callers/importers |
| d=2 | LIKELY AFFECTED | Indirect dependencies |
| d=3 | MAY NEED TESTING | Transitive effects |

## Workflow Checklist
```
Impact Analysis:
- [ ] READ gitnexus://repos to find the right repo
- [ ] gitnexus_impact(target, "upstream", repo) to find dependents
- [ ] READ gitnexus://repo/{name}/clusters to understand affected areas
- [ ] Check high-confidence (>0.8) dependencies first
- [ ] Count affected clusters (cross-cutting = higher risk)
- [ ] If >10 processes affected, consider splitting change
```

## Resource Reference

### gitnexus://repo/{name}/clusters
Check which clusters might be affected:
```yaml
clusters:
  - name: Auth
    symbols: 47
  - name: API
    symbols: 32
```

### gitnexus://repo/{name}/processes
Find which processes touch the target:
```yaml
processes:
  - name: LoginFlow
    type: cross_community
    steps: 5
```

## Tool Reference

### gitnexus_impact
Analyze blast radius:
```
gitnexus_impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3,
  repo: "my-app"
})

→ d=1 (WILL BREAK):
  - loginHandler (src/auth/login.ts:42) [CALLS, 100%]
  - apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

→ d=2 (LIKELY AFFECTED):
  - authRouter (src/routes/auth.ts:22) [CALLS, 95%]

→ Affected Processes: LoginFlow, TokenRefresh
→ Risk: MEDIUM (3 processes)
```

## Risk Assessment

| Affected | Risk |
|----------|------|
| <5 symbols, 1 cluster | LOW |
| 5-15 symbols, 1-2 clusters | MEDIUM |
| >15 symbols or 3+ clusters | HIGH |
| Critical path (auth, payments) | CRITICAL |

## Pre-Change Checklist
```
Before Committing:
- [ ] Run impact analysis
- [ ] Review all d=1 (WILL BREAK) items
- [ ] Verify test coverage for affected processes
- [ ] If risk > MEDIUM, get code review
- [ ] If cross-cluster, coordinate with other teams
```

## Example: "What breaks if I change validateUser?"

```
1. gitnexus_impact({target: "validateUser", direction: "upstream", repo: "my-app"})
   → d=1: loginHandler, apiMiddleware
   → d=2: authRouter, sessionManager

2. READ gitnexus://repo/my-app/clusters
   → Auth and API clusters affected

3. Decision: 2 direct callers, 2 clusters = MEDIUM risk
```
