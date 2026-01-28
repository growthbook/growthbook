---
description: "Backend API patterns for both internal and external APIs"
globs: ["packages/back-end/src/**/*.ts"]
alwaysApply: false
---

# Backend API Patterns

The back-end serves **two distinct types of APIs** with different patterns and purposes:

1. **Internal API** - Used by the GrowthBook front-end application
2. **External REST API** - Public API for customers to integrate with GrowthBook

## Internal API (Front-end Application)

The internal API powers the GrowthBook web application and uses a traditional controller/router pattern.

### Location & Structure

- Controllers: `packages/back-end/src/controllers/`
- Routers: `packages/back-end/src/routers/`
- Mounted in: `packages/back-end/src/app.ts`

### Controller Pattern

- Controllers export named functions that are HTTP handlers
- Wrap controllers with `wrapController()` for automatic error handling
- Controllers handle authentication via session cookies
- Return data directly in responses

**Example:**

```typescript
// In controllers/myController.ts
export const getMyResource = async (req: AuthRequest, res: Response) => {
  const { org } = getContextFromReq(req);
  const data = await getResourceData(org.id);
  res.status(200).json({ data });
};

// In app.ts or a router
import * as myControllerRaw from "./controllers/myController";
const myController = wrapController(myControllerRaw);

app.get("/api/my-resource", myController.getMyResource);
```

### Router Pattern (Internal)

- Routers in `src/routers/` organize related endpoints
- Use Express Router
- Handle session-based authentication
- Example: `src/routers/users/users.router.ts`, `src/routers/organizations/organizations.router.ts`

### Additional Rules

- If creating a new controller and router, use the pattern of putting the router in the `src/routers/` directory, and not using the `back-end/src/app.ts` file - that is the old way of doing things.
- If building a new model, the model should not be exported from the model file - only the functions and methods should be exported.

## External REST API (Customer Integration)

The external REST API is for customers to integrate with GrowthBook programmatically.

### Location & Structure

- All external API routes: `packages/back-end/src/api/`
- Each resource has its own directory with a `*.router.ts` file
- Mounted at: `/api/v1/` prefix
- Documented in OpenAPI spec at `src/api/openapi/`

**Example structure:**

```
src/api/
  features/
    features.router.ts
    getFeature.ts
    postFeature.ts
    putFeature.ts
    deleteFeature.ts
  experiments/
    experiments.router.ts
    getExperiments.ts
    ...
```

### API Model Pattern

- Use the `ApiModel` pattern for CRUD operations
- Automatically generates standard REST endpoints (GET, POST, PUT, DELETE)
- Define models in `packages/back-end/src/api/*/models.ts`
- Uses `createApiRequestHandler` for consistent request handling

**Example:**

```typescript
// In api/myresource/models.ts
export const MyResourceApiModel = {
  modelKey: "myResource",
  crudActions: ["list", "get", "create", "update", "delete"],
  // ... configuration
};

// Router automatically generated with:
// GET /api/v1/myresources
// GET /api/v1/myresources/:id
// POST /api/v1/myresources
// PUT /api/v1/myresources/:id
// DELETE /api/v1/myresources/:id
```

### Custom Handlers (External API)

For endpoints that don't fit CRUD patterns, define custom handlers:

```typescript
// In api/myresource/myresource.router.ts
import { createApiRequestHandler } from "../utils";

const myCustomHandler = createApiRequestHandler(validator)(async (req) => {
  // Custom logic here
  return { data: result };
});

router.post("/my-custom-endpoint", myCustomHandler);
```

### Authentication (External API)

- Uses API key authentication via `authenticateApiRequestMiddleware`
- API keys passed in `Authorization: Bearer <key>` header
- Context available at `req.context.org`, `req.context.permissions`

## Common Patterns (Both APIs)

### Request Validation

- Use Zod for all request validation
- Validators in `packages/back-end/src/validators/` (back-end only)
- Validators in `packages/shared/src/validators/` (shared with front-end)

### Permissions

- Use `permissionsUtil` class and its helpers when checking permissions
- Check permissions before sensitive operations
- Available at `req.context.permissions`

### Models

- **Leverage the BaseModel** - When adding a new model, default to using the BaseModel except for rare cases
- Models are in `packages/back-end/src/models/`
- BaseModel provides standard CRUD operations, validation, and hooks

## Key Differences Summary

| Aspect             | Internal API                       | External REST API                  |
| ------------------ | ---------------------------------- | ---------------------------------- |
| **Location**       | `src/controllers/`, `src/routers/` | `src/api/`                         |
| **Authentication** | Session cookies                    | API keys (Bearer token)            |
| **Pattern**        | Controllers + wrapController       | ApiModel + createApiRequestHandler |
| **Audience**       | GrowthBook web app                 | Customer integrations              |
| **Documentation**  | Internal only                      | OpenAPI spec                       |
| **URL Prefix**     | `/api/*`                           | `/api/v1/*`                        |
