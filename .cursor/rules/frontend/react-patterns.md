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
