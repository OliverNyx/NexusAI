# Framework Support for Entry Point Detection

GitNexus automatically detects frameworks and boosts entry point scores for known patterns.

## Status Legend
- ✅ Supported (path-based detection)
- ❌ Not yet supported

---

## JavaScript / TypeScript

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| Next.js (Pages) | ✅ | `/pages/*.tsx` | 3.0x |
| Next.js (App) | ✅ | `/app/*/page.tsx` | 3.0x |
| Next.js API | ✅ | `/pages/api/*`, `/app/*/route.ts` | 3.0x |
| Express.js | ✅ | `/routes/*` | 2.5x |
| React | ✅ | `/components/*.tsx` (PascalCase) | 1.5x |
| NestJS | ❌ | TODO: `@Controller` decorator | - |

## Python

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| Django | ✅ | `views.py`, `urls.py` | 3.0x |
| FastAPI | ✅ | `/routers/*`, `/endpoints/*` | 2.5x |
| Flask | ✅ | `/routes/*` | 2.5x |

## Java

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| Spring Boot | ✅ | `/controller/*`, `*Controller.java` | 3.0x |
| JAX-RS | ❌ | TODO: `@Path` annotation | - |

## C#

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| ASP.NET Core | ✅ | `/Controllers/*`, `*Controller.cs` | 3.0x |
| Blazor | ✅ | `/Pages/*.razor` | 2.5x |

## Go

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| net/http | ✅ | `/handlers/*`, `main.go` | 2.5-3.0x |
| Gin/Echo | ✅ | `/handlers/*`, `/routes/*` | 2.5x |

## Rust

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| Actix/Axum/Rocket | ✅ | `/handlers/*`, `main.rs` | 2.5-3.0x |

## C / C++

| Framework | Status | Detection Pattern | Multiplier |
|-----------|--------|-------------------|------------|
| Generic | ✅ | `main.c`, `main.cpp` | 3.0x |

---

## Adding New Framework Support

1. Edit `framework-detection.ts` → `detectFrameworkFromPath()`
2. Add path pattern with appropriate multiplier
3. Update this documentation
4. Test with a sample project

## Graceful Fallback

Unknown frameworks return `null`, resulting in a **1.0x multiplier** (no bonus, no penalty).
