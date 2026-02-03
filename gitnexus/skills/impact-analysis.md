---
name: gitnexus-impact-analysis
description: Analyze blast radius before making code changes
---

# Impact Analysis

## Quick Start
1. `gitnexus_impact(target, "upstream")` → What depends on this (will break)
2. Review affected processes and clusters
3. Assess risk level

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

| Confidence | Meaning |
|------------|---------|
| 1.0 | Certain (static analysis) |
| 0.8+ | High confidence |
| <0.8 | Fuzzy match (may be false positive) |

## Workflow
```
Impact Analysis:
- [ ] gitnexus_impact(target, "upstream") to find dependents
- [ ] Review affected processes
- [ ] Check high-confidence (>0.8) dependencies first
- [ ] Count affected clusters (cross-cutting = higher risk)
- [ ] If >10 processes affected, consider splitting change
```

## Tool Reference

### gitnexus_impact
Analyze blast radius.
```
gitnexus_impact({
  target: "validateUser",
  direction: "upstream",
  minConfidence: 0.8,
  maxDepth: 3,
  includeTests: false
})
```

**Parameters:**
- `target` — Function, class, or file name
- `direction` — "upstream" (what depends on this) or "downstream" (what this depends on)
- `minConfidence` — Filter out fuzzy matches (default: 0.7)
- `maxDepth` — How far to trace (default: 3)
- `includeTests` — Include test files (default: false)

**Output:**
```
Impact Analysis for "validateUser":

d=1 (WILL BREAK):
- loginHandler (src/auth/login.ts:42) [CALLS, 100%]
- apiMiddleware (src/api/middleware.ts:15) [CALLS, 100%]

d=2 (LIKELY AFFECTED):
- authRouter (src/routes/auth.ts:22) [CALLS, 95%]
- sessionManager (src/session/manager.ts:88) [CALLS, 90%]

Affected Processes: LoginFlow, TokenRefresh, APIGateway
Affected Clusters: Auth, API

Risk: MEDIUM (3 processes, 2 clusters)
```

## Example: "What breaks if I change validateUser?"

1. **Run impact analysis**
   ```
   gitnexus_impact({
     target: "validateUser",
     direction: "upstream",
     minConfidence: 0.8
   })
   ```

2. **Review output**
   - d=1: loginHandler, apiMiddleware (WILL BREAK)
   - d=2: authRouter, sessionManager (LIKELY AFFECTED)
   - Processes: LoginFlow, TokenRefresh, APIGateway
   - Risk: MEDIUM

3. **Decision**
   - 2 direct callers → manageable
   - 3 processes → need to test all three
   - Auth + API clusters → may need API team coordination

## Risk Assessment Guide

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

## When to Use Something Else

| Need | Use Instead |
|------|-------------|
| Explore unfamiliar code | `gitnexus-exploring` skill |
| Debug failing code | `gitnexus-debugging` skill |
| Plan large refactors | `gitnexus-refactoring` skill |
