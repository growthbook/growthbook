---
description: "TypeScript and React conventions for front-end development"
globs: ["packages/front-end/**/*.tsx", "packages/front-end/**/*.ts"]
alwaysApply: false
---

# Frontend React & TypeScript Patterns

## Component Structure

- Use **functional components** with TypeScript
- Define props interfaces inline or as separate types
- Use explicit return types for complex functions

### Example Component Structure

```typescript
import { ReactNode } from "react";
import { useUser } from "@/services/UserContext";

export default function MyComponent({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { organization, hasCommercialFeature } = useUser();
  const hasFeature = hasCommercialFeature("feature-name");

  // Component logic here

  return (
    <div>
      {/* JSX here */}
    </div>
  );
}
```

## Commercial Features

- Check feature availability with `hasCommercialFeature("feature-name")`
- Wrap premium features with `<PremiumTooltip commercialFeature="feature-name">`
- Feature flags are defined in `packages/shared/src/enterprise/license-consts.ts`

## Common Hooks

- `useUser()` - Access user context, organization, permissions
- `useEnvironments()` - Get available environments
- `useDefinitions()` - Access metrics, features, segments
- `useAuth()` - Authentication state

Context providers are in `packages/front-end/services/`

## UI Component Hierarchy

When building UI, follow this priority order for component selection:

### 1. Design System Components (`@/ui/`) - PREFERRED

Always check the design system first. These components are purpose-built for GrowthBook and provide consistent styling and behavior:

```typescript
// ✅ Preferred - use design system components
import { Button } from "@/ui/Button";
import { Badge } from "@/ui/Badge";
import { Checkbox } from "@/ui/Checkbox";
import { Select } from "@/ui/Select";
import { Tabs } from "@/ui/Tabs";
import { Table } from "@/ui/Table";
import { Callout } from "@/ui/Callout";
import { Link } from "@/ui/Link";
import { Switch } from "@/ui/Switch";
import { RadioGroup } from "@/ui/RadioGroup";
import { RadioCards } from "@/ui/RadioCards";
import { DropdownMenu } from "@/ui/DropdownMenu";
import { Avatar } from "@/ui/Avatar";
import { DataList } from "@/ui/DataList";
import { Popover } from "@/ui/Popover";
import { HelperText } from "@/ui/HelperText";
import { Tooltip } from "@/ui/Tooltip";
```

Available design system components: Avatar, Badge, Button, Callout, Checkbox, ConfirmDialog, DataList, DropdownMenu, ErrorDisplay, Frame, HelperText, Link, LinkButton, Metadata, Pagination, Popover, PremiumCallout, RadioCards, RadioGroup, Select, SplitButton, Switch, Table, Tabs, Tooltip

### 2. Radix Themes - SECONDARY

If a component doesn't exist in `@/ui/`, check Radix Themes. Use for layout primitives and components not yet wrapped in our design system:

```typescript
// ✅ OK when no @/ui/ equivalent exists
import { Flex, Box, Grid, Text, Heading } from "@radix-ui/themes";
```

### 3. Existing GrowthBook Components - TERTIARY

Check `packages/front-end/components/` for domain-specific components that may already exist.

### 4. Build New Components - LAST RESORT

If none of the above work, build a new component.

**Before building inline or one-off components, ask yourself:** Could this be useful elsewhere in the codebase? If the component is generic and reusable (not domain-specific), propose adding it to `@/ui/` instead of building it inline.

**When to suggest a new `@/ui/` component:**

- The pattern is generic (not tied to a specific feature/domain)
- Similar UI patterns exist elsewhere in the codebase
- The component wraps a Radix primitive with GrowthBook-specific styling
- You're about to duplicate similar markup/logic in multiple places

**Ask the user before creating:** "This looks like a reusable pattern. Should I create a new `@/ui/ComponentName` component that can be used across the codebase?"

New `@/ui/` components should:

- Live in `packages/front-end/ui/`
- Include a `.stories.tsx` file for Storybook documentation
- Follow existing component patterns in that folder

## Avoid Bootstrap

**Bootstrap classes are legacy and should NOT be used in new code.** The codebase is migrating away from Bootstrap toward our design system.

### ❌ DON'T - Bootstrap Classes

```tsx
// ❌ Bad - Bootstrap utility classes
<div className="d-flex justify-content-between align-items-center">
<div className="mb-3 mt-2">
<div className="btn btn-primary">
<span className="badge bg-success">
<div className="container-fluid">
<div className="row">
<div className="col-md-6">
```

### ✅ DO - Design System & Radix Themes

```tsx
// ✅ Good - Radix Themes layout primitives
<Flex justify="between" align="center">
<Box mb="3" mt="2">

// ✅ Good - Design system components
<Button variant="solid">Click me</Button>
<Badge color="green">Active</Badge>

// ✅ Good - CSS Modules or inline styles when needed
<div className={styles.container}>
<div style={{ display: "flex", gap: "8px" }}>
```

### Common Bootstrap → Design System Migrations

| Bootstrap Class              | Replacement                               |
| ---------------------------- | ----------------------------------------- |
| `btn btn-primary`            | `<Button>` from `@/ui/Button`             |
| `btn btn-outline-*`          | `<Button variant="outline">`              |
| `badge bg-*`                 | `<Badge>` from `@/ui/Badge`               |
| `form-check` / `form-switch` | `<Checkbox>` or `<Switch>` from `@/ui/`   |
| `nav nav-tabs`               | `<Tabs>` from `@/ui/Tabs`                 |
| `table`                      | `<Table>` from `@/ui/Table`               |
| `alert alert-*`              | `<Callout>` from `@/ui/Callout`           |
| `dropdown`                   | `<DropdownMenu>` from `@/ui/DropdownMenu` |
| `d-flex`                     | `<Flex>` from `@radix-ui/themes`          |
| `d-none` / `d-block`         | Conditional rendering or CSS              |
| `mb-*` / `mt-*` / `mx-*`     | `<Box mb="3">` or style props             |
| `row` / `col-*`              | `<Grid>` from `@radix-ui/themes`          |
| `text-center` / `text-end`   | `<Text align="center">` or CSS            |

### When You Encounter Bootstrap

If you're modifying code that uses Bootstrap:

1. **Small changes**: OK to leave existing Bootstrap, but don't add more
2. **New features**: Use design system components exclusively
3. **Refactoring**: Migrate Bootstrap to design system when touching that code
