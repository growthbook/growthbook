---
description: "Data fetching and mutation patterns for the front-end application"
globs: ["packages/front-end/**/*.tsx", "packages/front-end/**/*.ts"]
alwaysApply: false
---

# Frontend Data Fetching Patterns

## Overview

GrowthBook uses SWR for data fetching with a custom `useApi()` hook, and `apiCall()` for mutations. All requests are automatically scoped to the current organization.

## Fetching Data - useApi()

The `useApi()` hook is the primary way to fetch data. It's built on SWR and provides caching, revalidation, and organization scoping.

**Location:** `packages/front-end/hooks/useApi.ts`

### Basic Usage

```typescript
import useApi from "@/hooks/useApi";

// Simple fetch
const { data, error, mutate } = useApi<{ items: ItemInterface[] }>("/items");

// With query parameters
const { data, error, mutate } = useApi<{ experiments: ExperimentInterface[] }>(
  `/experiments?project=${project || ""}&includeArchived=${includeArchived ? "1" : ""}`,
);
```

### Return Values

- `data` - The response data (undefined while loading)
- `error` - Error object if request failed
- `mutate` - Function to revalidate/update the cache
- `isLoading` - Boolean indicating loading state (from SWR)

### Options

```typescript
useApi<Response>(path, {
  shouldRun?: () => boolean,    // Conditional execution
  autoRevalidate?: boolean,     // Default: true - revalidate on focus/reconnect
  orgScoped?: boolean,          // Default: true - scope cache to organization
});
```

### Conditional Fetching

Use `shouldRun` to conditionally fetch data:

```typescript
// Only fetch when user is authenticated
const { data } = useApi<UserResponse>(`/user`, {
  shouldRun: () => isAuthenticated,
  orgScoped: false,
});

// Only fetch when we have an ID
const { data } = useApi<FeatureResponse>(`/feature/${featureId}`, {
  shouldRun: () => !!featureId,
});
```

### Disable Auto-Revalidation

For data that shouldn't refresh automatically (e.g., form editing):

```typescript
const { data, mutate } = useApi<DataResponse>("/endpoint", {
  autoRevalidate: false,
});
```

## Mutations - apiCall()

For POST, PUT, PATCH, DELETE operations, use `apiCall()` from the auth context.

### Basic Usage

```typescript
import { useAuth } from "@/services/auth";

function MyComponent() {
  const { apiCall } = useAuth();

  const handleCreate = async () => {
    await apiCall("/items", {
      method: "POST",
      body: JSON.stringify({ name: "New Item" }),
    });
  };

  const handleUpdate = async (id: string) => {
    await apiCall(`/items/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Name" }),
    });
  };

  const handleDelete = async (id: string) => {
    await apiCall(`/items/${id}`, {
      method: "DELETE",
    });
  };
}
```

### With Cache Revalidation

After mutations, call `mutate()` to refresh the cached data:

```typescript
function MyComponent() {
  const { apiCall } = useAuth();
  const { data, mutate } = useApi<{ items: ItemInterface[] }>("/items");

  const handleCreate = async (formData: CreateItemData) => {
    try {
      await apiCall("/items", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      // Revalidate the list after creation
      await mutate();
    } catch (e) {
      // Handle error
      console.error(e);
    }
  };
}
```

### Typed Responses

```typescript
const response = await apiCall<{ item: ItemInterface; message?: string }>(
  "/items",
  {
    method: "POST",
    body: JSON.stringify(data),
  },
);

// Access typed response
console.log(response.item.id);
```

## Error Handling Patterns

### Pattern 1: Try-Catch with State

```typescript
const [error, setError] = useState<string | null>(null);

const handleSubmit = async (data: FormData) => {
  setError(null);
  try {
    const response = await apiCall<{ error?: string }>("/endpoint", {
      method: "POST",
      body: JSON.stringify(data),
    });

    if (response.error) {
      setError(response.error);
      return;
    }

    mutate(); // Refresh data on success
  } catch (e) {
    setError(e.message || "An error occurred");
  }
};
```

### Pattern 2: Modal Error Handling

When using the `Modal` component, errors thrown in `submit` are automatically displayed:

```typescript
<Modal
  header="Create Item"
  submit={async () => {
    await apiCall("/items", {
      method: "POST",
      body: JSON.stringify(formData),
    });
    mutate();
  }}
>
  {/* Form fields */}
</Modal>
```

### Pattern 3: Check Error in useApi

```typescript
const { data, error } = useApi<DataResponse>("/endpoint");

if (error) {
  return <div className="alert alert-danger">{error.message}</div>;
}

if (!data) {
  return <LoadingSpinner />;
}

return <MyContent data={data} />;
```

## Common Patterns

### Fetch with Loading State

```typescript
const { data, error } = useApi<{ features: FeatureInterface[] }>("/features");

if (error) return <ErrorDisplay error={error} />;
if (!data) return <LoadingOverlay />;

return <FeatureList features={data.features} />;
```

### Optimistic Updates

Update the cache immediately, then revalidate:

```typescript
const { data, mutate } = useApi<{ items: ItemInterface[] }>("/items");

const handleToggle = async (id: string, enabled: boolean) => {
  // Optimistically update UI
  mutate(
    {
      items: data.items.map((item) =>
        item.id === id ? { ...item, enabled } : item,
      ),
    },
    false, // Don't revalidate yet
  );

  try {
    await apiCall(`/items/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    });
    // Revalidate to confirm
    await mutate();
  } catch (e) {
    // Revert on error
    await mutate();
  }
};
```

### Refresh Multiple Caches

```typescript
const { mutate: mutateFeatures } = useApi<FeaturesResponse>("/features");
const { mutate: mutateExperiments } =
  useApi<ExperimentsResponse>("/experiments");

const handleBulkAction = async () => {
  await apiCall("/bulk-action", { method: "POST", body: JSON.stringify(data) });
  // Refresh both caches
  await Promise.all([mutateFeatures(), mutateExperiments()]);
};
```

### Using mutateDefinitions for Global State

For data that affects the global definitions context (metrics, features, segments):

```typescript
import { useDefinitions } from "@/services/DefinitionsContext";

function MyComponent() {
  const { mutateDefinitions } = useDefinitions();

  const handleCreateMetric = async () => {
    await apiCall("/metrics", {
      method: "POST",
      body: JSON.stringify(metricData),
    });
    // Refresh the global definitions cache
    mutateDefinitions();
  };
}
```

## Organization Context

All API requests automatically include:

- `Authorization: Bearer <token>` header
- `X-Organization: <orgId>` header
- Cache keys are prefixed with `orgId::` for organization scoping

This means switching organizations automatically invalidates all cached data.

## Key Hooks Summary

| Hook               | Purpose                                    | Location                        |
| ------------------ | ------------------------------------------ | ------------------------------- |
| `useApi()`         | SWR-based data fetching                    | `@/hooks/useApi`                |
| `useAuth()`        | Access `apiCall()` for mutations           | `@/services/auth`               |
| `useDefinitions()` | Global definitions + `mutateDefinitions()` | `@/services/DefinitionsContext` |
| `useUser()`        | User context with `refreshOrganization()`  | `@/services/UserContext`        |
