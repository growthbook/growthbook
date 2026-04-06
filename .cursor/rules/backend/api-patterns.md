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

- Mounted at: `/api/v1/` prefix
- BaseModel resources can provide `apiConfig` to define their API endpoints
- OpenAPI docs are auto-generated from Zod schemas in `src/api/specs/*.spec.ts`
- Legacy definitions for API routes are in `packages/back-end/src/api/` with corresponding yaml specs in `packages/back-end/src/api/openapi/`

> **⚠️ Avoid creating new hand-written YAML files** in `src/api/openapi/paths/`, `src/api/openapi/payload-schemas/`, or `src/api/openapi/schemas/`. These directories contain legacy definitions that have not yet been migrated. New endpoints should use the spec-based approach described below whenever possible.

### Spec-Based Pattern (for BaseModel-compatible endpoints)

Any endpoint backed by a `BaseModel` should use the `apiConfig` + spec pattern. This can be used to auto-generate standard CRUD endpoints, OpenAPI documentation, and routing from minimal definitions in Zod. If an endpoint uses a legacy (non-BaseModel) resource or isn't directly related to any models, then use the legacy pattern defined below.

The configuration is split into two parts:

1. **OpenAPI spec** (`src/api/specs/*.spec.ts`) — Zod schemas and metadata for doc generation. No runtime handler code.
2. **API config** (`apiConfig` in the model's `MakeModelClass` call) — References the spec and adds runtime handlers.

#### Step 1: Create the OpenAPI spec

Create a spec file in `src/api/specs/` with the model's API metadata:

```typescript
// In src/api/specs/my-resource.spec.ts
import {
  apiMyResourceValidator,
  apiCreateMyResourceBody,
  apiUpdateMyResourceBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const myResourceApiSpec = {
  modelSingular: "myResource",
  modelPlural: "myResources",
  pathBase: "/my-resources",
  apiInterface: apiMyResourceValidator,
  schemas: {
    createBody: apiCreateMyResourceBody,
    updateBody: apiUpdateMyResourceBody,
  },
  includeDefaultCrud: true, // Generates get, create, list, update, delete
  // OR pick specific actions:
  // crudActions: ["get", "list", "create"],
} satisfies OpenApiModelSpec;
export default myResourceApiSpec;
```

**Important:**

- Use `satisfies OpenApiModelSpec` (not `: OpenApiModelSpec`) so TypeScript preserves the narrow types for proper inference in the model.
- Include `export default` for the OpenApiModelSpec object — the generate script dynamically discovers spec files and requires a default export.

#### Step 2: Wire up the API config in the model

```typescript
// In src/models/MyResourceModel.ts
import { myResourceApiSpec } from "back-end/src/api/specs/my-resource.spec";

const BaseClass = MakeModelClass({
  // ... schema, collectionName, etc.
  apiConfig: {
    modelKey: "myResources",
    openApiSpec: myResourceApiSpec,
  },
});
```

This auto-generates routes like:

- `GET /api/v1/my-resources` — list
- `GET /api/v1/my-resources/:id` — get
- `POST /api/v1/my-resources` — create
- `PUT /api/v1/my-resources/:id` — update
- `DELETE /api/v1/my-resources/:id` — delete

#### Step 3: Register the model for routing

Add the model class to the `API_MODELS` array in `src/api/api.router.ts`.

#### Custom endpoints

For endpoints beyond standard CRUD, define endpoint specs in the spec file and handlers in the model:

```typescript
// In src/api/specs/my-resource.spec.ts
export const myCustomEndpoint = {
  pathFragment: "/:id/archive",
  verb: "post" as const,
  operationId: "archiveMyResource",
  validator: myArchiveValidator,
  zodReturnObject: myArchiveReturn,
  summary: "Archive a resource",
};

export const myResourceApiSpec = {
  // ... base config
  customEndpoints: [myCustomEndpoint],
} satisfies OpenApiModelSpec;

// In src/models/MyResourceModel.ts
const BaseClass = MakeModelClass({
  // ...
  apiConfig: {
    modelKey: "myResources",
    openApiSpec: myResourceApiSpec,
    customHandlers: [
      defineCustomApiHandler({
        ...myCustomEndpoint,
        reqHandler: async (req) => {
          // Runtime handler logic here
          return { status: 200 };
        },
      }),
    ],
  },
});
```

Note how the endpoint spec (metadata for docs) is spread into `defineCustomApiHandler` which adds the runtime `reqHandler`. This keeps doc-generation concerns separate from runtime code.

### Legacy Pattern (Non-BaseModel or Resourceless Endpoints Only)

Some external API endpoints are not backed by a `BaseModel` — for example, ad-hoc RPC-style actions, query/exploration endpoints, or endpoints that orchestrate across multiple models without a single owning resource. For these cases, the older manual pattern is still acceptable:

- Create a resource directory under `src/api/` with a `*.router.ts` and individual handler files
- Define yaml files for each endpoint and payload schema in `src/api/openapi/`. Running `generate-api-types` will add exported validators to `shared/src/validators/openapi.ts` for each.
- Use `createApiRequestHandler()` with Zod validators (imported from `shared/validators`) in each handler
- Register the router manually in `src/api/api.router.ts`

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
