---
description: "GrowthBook project architecture, monorepo structure, and package organization"
alwaysApply: true
---

# GrowthBook Project Overview

You are working on GrowthBook, an open-source feature flagging and A/B testing platform.

## Monorepo Structure

- This is a monorepo managed by **pnpm workspaces**
- Use `pnpm` for all package management operations (never npm or yarn)
- Packages are located in the `packages/` directory

## Package Organization

### packages/front-end - Next.js application (UI)

- Next.js app serving the full GrowthBook UI
- Runs on http://localhost:3000 in development
- TypeScript with React functional components
- Uses path alias `@/` for imports (e.g., `@/components`, `@/services`, `@/ui`)

### packages/back-end - Express API server

- Runs on http://localhost:3100 in development
- MongoDB as primary data store
- Uses `back-end/` prefix for internal imports
- Serves two distinct APIs:
  1. **Internal API** - Used by the GrowthBook front-end application (controllers, routers in `src/controllers/`, `src/routers/`)
  2. **External REST API** - Public API for customers to integrate with GrowthBook (located in `src/api/` directory)

### packages/shared - Shared TypeScript code

- Common types, utilities, validators, and constants
- Shared between front-end and back-end
- No UI components or server-specific code

### packages/stats - Python statistics engine

- Python 3.9+ package called `gbstats`
- Managed by Poetry for dependencies
- Statistical computations for A/B testing
- Uses pandas, numpy, scipy

### packages/sdk-js - JavaScript SDK

- Published as `@growthbook/growthbook` on npm
- Fully isolated from internal packages

### packages/sdk-react - React SDK

- Published as `@growthbook/growthbook-react` on npm
- Fully isolated from internal packages

## Enterprise Code

- `packages/front-end/enterprise/` - Non-open source front-end features
- `packages/back-end/src/enterprise/` - Non-open source back-end features
- `packages/shared/src/enterprise/` - Non-open source shared code
- Do NOT typically accept outside contributions to enterprise directories
