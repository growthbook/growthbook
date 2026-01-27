---
description: "Critical package import restrictions enforced by ESLint - must be strictly followed"
alwaysApply: true
---

# Package Import Boundaries

These restrictions are enforced by ESLint and must be strictly followed.

## Front-end Package

- ✅ CAN import from: `shared` package, itself
- ❌ CANNOT import from: `back-end`, `sdk-js`, `sdk-react`
- ❌ DO NOT import Radix UI components directly - use design system wrappers from `@/ui/` instead
  - Bad: `import { Button } from "@radix-ui/themes"`
  - Good: `import { Button } from "@/ui/Button"`
  - Affected components: Avatar, Badge, Button, Callout, Checkbox, DataList, DropdownMenu, Link, RadioCards, RadioGroup, Select, Switch, Table, Tabs
- ❌ DO NOT use `window.history.pushState` or `window.history.replaceState` directly
  - Use `router.push(url, undefined, { shallow: true })` from `next/router` instead

## Back-end Package

- ✅ CAN import from: `shared` package, itself
- ❌ CANNOT import from: `front-end`, `sdk-js`, `sdk-react`
- ❌ DO NOT import `node-fetch` directly
  - Use `import { fetch } from "back-end/src/util/http.util"` instead

## Shared Package

- ✅ CAN import from: itself only
- ❌ CANNOT import from: `back-end`, `front-end`
- ❌ DO NOT use `.default()` on Zod schemas in `packages/shared/src/validators/*`
  - Use the `defaultValues` option in the BaseModel config instead

## SDK Packages

- ✅ CAN import from: themselves only
- ❌ CANNOT import from: `back-end`, `front-end`, `shared`, or any internal package
- Must remain fully isolated for npm distribution
