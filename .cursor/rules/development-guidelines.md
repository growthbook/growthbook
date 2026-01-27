---
description: "General development guidelines, code quality standards, and common patterns"
alwaysApply: true
---

# Development Guidelines

## General Rules

- **Do NOT write tests** unless explicitly requested by the user
- Follow existing patterns in the codebase
- When in doubt, search for similar existing code and follow that pattern
- Use existing ESLint rules - they're comprehensive and enforced in CI
- Do not use `//eslint-disable-next-line` comments to fix type issues

## Code Quality

- TypeScript: Use strict types, avoid `any` when possible (ESLint warns on `any`)
- Unused variables: Prefix with `_` to indicate intentionally unused
- Console logging: Avoid `console.log` in production code (ESLint warns)

## Common Patterns

### Zod Validation

```typescript
import { z } from "zod";

const mySchema = z.object({
  name: z.string(),
  count: z.number().int().positive(),
});

type MyType = z.infer<typeof mySchema>;
```

### Type Definitions

- Shared types go in `packages/shared/types/*.d.ts`
- Use `.d.ts` files for type-only definitions
- Export types with `export type` or `export interface`

### Environment Variables

- Back-end: Define in `packages/back-end/src/util/secrets.ts`
- Front-end: Define in `packages/front-end/services/env.ts`
- Use environment-specific `.env.local` files for local overrides

## Code Quality Commands

- **Lint**: `pnpm lint` (auto-fixes issues)
- **Type check**: `pnpm type-check` (all packages)
- **Format**: `pnpm pretty` (Prettier formatting)

## Key Principles

1. **Respect package boundaries** - front-end, back-end, and shared have strict import restrictions
2. **Use design system components** - don't import Radix UI directly in front-end
3. **Follow existing patterns** - search the codebase for similar code
4. **Use pnpm** - this is a pnpm workspace
5. **No tests by default** - only write tests if explicitly requested
6. **TypeScript strict mode** - use proper types, avoid `any`
7. **Check commercial features** - use `hasCommercialFeature()` for premium functionality
8. **Router pattern for APIs** - organize by resource with dedicated router files
9. **Leverage the BaseModel** - when adding a new model, default to using the BaseModel except for rare cases
10. **Use permissionsUtil** - when checking permissions, leverage the permissionsUtil class and it's included helpers

These rules ensure consistency and maintainability across the GrowthBook codebase.
