# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Install dependencies
pnpm install

# Initial setup (builds shared deps + stats engine)
pnpm setup

# Development (starts back-end, front-end, and shared in watch mode)
pnpm dev              # Full dev with stats engine activated
pnpm dev:apps         # Without stats engine
pnpm dev:back-end     # Back-end only

# Building
pnpm build:deps       # Build shared packages (sdk-js, sdk-react, shared)
pnpm build:app        # Build back-end + front-end
pnpm build            # Full build (deps + app)

# Code quality
pnpm lint             # ESLint with auto-fix
pnpm type-check       # TypeScript check all packages
pnpm pretty           # Prettier formatting

# Single-package type-check
pnpm --filter front-end type-check
pnpm --filter back-end type-check
pnpm --filter shared type-check

# Testing
pnpm test             # All packages
pnpm --filter front-end test    # Front-end only (Vitest)
pnpm --filter back-end test     # Back-end only (Jest)
pnpm --filter shared test       # Shared only (Jest)

# Run a single test file
pnpm --filter back-end test path/to/test.ts
```

**Requirements:** Node.js 24+, pnpm 10.28.2, Python 3.9+ with Poetry (for stats engine), Docker (for MongoDB)

## Architecture

### Monorepo Structure (pnpm workspaces)

- **`packages/front-end`** — Next.js 14 app (pages router), Vitest for tests, port 3000
- **`packages/back-end`** — Express API server, Jest for tests, MongoDB via Mongoose, port 3100
- **`packages/shared`** — Types, Zod validators, utilities shared between front-end and back-end
- **`packages/sdk-js`** — Published as `@growthbook/growthbook`, zero-dependency JS SDK
- **`packages/sdk-react`** — Published as `@growthbook/growthbook-react`, zero-dependency React SDK
- **`packages/stats`** — Python (Poetry) statistical engine for A/B testing

### Import Boundaries (ESLint-enforced)

| Package   | Can import from           |
| --------- | ------------------------- |
| front-end | shared, sdk-js, sdk-react |
| back-end  | shared, sdk-js            |
| shared    | sdk-js                    |
| sdk-js    | nothing (zero deps)       |
| sdk-react | sdk-js only (zero deps)   |

**Additional restrictions:**

- Front-end: Use `@/ui/` wrappers instead of direct Radix UI imports
- Front-end: Use `router.push()` instead of `window.history.pushState/replaceState`
- Back-end: Use `import { fetch } from "back-end/src/util/http.util"` instead of `node-fetch`
- Shared: Don't use `.default()` on Zod schemas (use `defaultValues` in BaseModel config)

### Back-end: Two API Types

1. **Internal API** (for front-end app): Controllers in `src/controllers/` + routers in `src/routers/`, session cookie auth, wrapped with `wrapController()`
2. **External REST API** (for customers): Handlers in `src/api/`, mounted at `/api/v1/`, API key Bearer auth, uses `createApiRequestHandler()`

New routers go in `src/routers/`, not in `src/app.ts` (legacy pattern).

### Back-end: BaseModel Pattern

New data models use `MakeModelClass()` in `src/models/`. Define a Zod schema in shared, configure collection name and ID prefix, extend with permission methods (`canRead`, `canCreate`, `canUpdate`, `canDelete`). Register on `RequestContext` in `src/services/context.ts` for access via `req.context.myResources`.

### Front-end: Data Fetching

- **Read:** `useApi<T>("/endpoint")` — SWR-based hook with org-scoped caching
- **Write:** `apiCall("/endpoint", { method: "POST", body: JSON.stringify(data) })` from `useAuth()`
- **Cache refresh:** Call `mutate()` from useApi after mutations, or `mutateDefinitions()` for global state

### Front-end: UI Component Hierarchy

1. **`@/ui/`** (design system) — preferred: Button, Badge, Tabs, Table, Select, Callout, etc.
2. **`@radix-ui/themes`** — for layout: Flex, Box, Grid, Text, Heading
3. **`components/`** — existing domain-specific components
4. Bootstrap is legacy — don't use in new code

### Permission System

Three tiers: global (manageTeam, manageBilling), project-scoped (manageFeatures, createMetrics), environment-scoped (publishFeatures, runExperiments).

- **Front-end:** `usePermissionsUtil()` hook with methods like `canCreateFeature({ project })`
- **Back-end:** `context.permissions.canUpdateFeature(existing, updated)` from `getContextFromReq(req)`
- **Commercial features:** `hasCommercialFeature("feature-name")` (front-end from `useUser()`), `context.hasPremiumFeature("feature-name")` (back-end)

## Code Conventions

- **TypeScript strict mode** — never use `any`, use `unknown` for untrusted data, validate with Zod
- **Environment variables** — only reference `process.env` in `back-end/src/util/secrets.ts` or `front-end/pages/api/init.ts`
- **Logging** — back-end uses `import { logger } from "util/logger"` (not `console.log`)
- **Testing policy** — write tests for utility/helper functions; do NOT write tests for front-end components or back-end routers/controllers/models
- **Zod as source of truth** — infer types from schemas (`z.infer<typeof mySchema>`), don't duplicate type definitions
