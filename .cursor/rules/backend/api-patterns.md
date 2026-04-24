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
- Handlers are in `src/api/` organized by resource, with routes registered in `src/api/api.router.ts`

### Spec-Based Pattern (for BaseModel-compatible endpoints)

Any endpoint backed by a `BaseModel` should use the `apiConfig` + spec pattern. This auto-generates standard CRUD endpoints, OpenAPI documentation, and routing from minimal definitions in Zod. If an endpoint isn't directly related to any model, use the non-BaseModel pattern described below.

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

#### Step 4: Implement `toApiInterface`

Any model that sets `apiConfig` **must** implement `toApiInterface` to convert internal documents to the API response shape. Without it, any changes to the internal model will immediately be exposed to the API, potentially breaking the API contract.

```typescript
export class MyResourceModel extends BaseClass {
  // ... permission methods ...

  protected toApiInterface(doc: MyResourceInterface): ApiMyResource {
    return {
      id: doc.id,
      dateCreated: doc.dateCreated.toISOString(),
      dateUpdated: doc.dateUpdated.toISOString(),
      name: doc.name,
      // ... map all fields required by ApiMyResource
    };
  }
}
```

#### Overriding standard CRUD handlers

The default `handleApiGet`, `handleApiCreate`, `handleApiList`, `handleApiDelete`, and `handleApiUpdate` implementations call `toApiInterface` and handle the basics. Override them when you need custom logic (e.g., a non-standard fetch, derived fields, or side effects).

Use `override` and derive the `req` type from the base class so it stays in sync with the validator automatically:

```typescript
export class MyResourceModel extends BaseClass {
  public override async handleApiGet(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiGet"]>[0],
  ): Promise<ApiMyResource> {
    // req.params.id is typed correctly from the validator
    const doc = await this.getBySlug(req.params.id);
    if (!doc) req.context.throwNotFoundError();
    return this.toApiInterface(doc);
  }
}
```

#### Customizing validator schemas with `crudValidatorOverrides`

Use `crudValidatorOverrides` in the spec when a standard CRUD action needs a non-default schema — most commonly to add query parameters to `delete` or `list`. Define the validator in the spec file so it's available for both doc generation and type inference in the model.

```typescript
// In src/api/specs/my-resource.spec.ts
export const apiDeleteMyResourceValidator = {
  paramsSchema: z.object({ id: z.string() }).strict(),
  bodySchema: z.never(),
  querySchema: z.strictObject({ permanent: z.boolean().optional() }),
};

export const myResourceApiSpec = {
  // ...
  crudValidatorOverrides: {
    delete: apiDeleteMyResourceValidator,
  },
} satisfies OpenApiModelSpec;

// In src/models/MyResourceModel.ts — req.query is now typed from the validator
export class MyResourceModel extends BaseClass {
  public override async handleApiDelete(
    req: Parameters<InstanceType<typeof BaseClass>["handleApiDelete"]>[0],
  ): Promise<string> {
    const permanent = req.query.permanent; // typed as boolean | undefined
    await this.deleteResource(req.params.id, permanent);
    return req.params.id;
  }
}
```

**How it works:** `MakeModelClass` infers the `crudValidatorOverrides` type from the spec and threads it through to `BaseModel`, where `handleApi*` method signatures automatically reflect the override schemas. The `Parameters<InstanceType<typeof BaseClass>["handleApi*"]>[0]` pattern in the override picks up these concrete types without requiring manual annotation.

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

#### Naming API schemas with `namedSchema`

When a Zod validator represents a top-level API model (the kind that should appear in the "Models" section of the API docs), wrap it with `namedSchema` from `shared/validators/openapi-helpers`:

```typescript
// In packages/shared/src/validators/my-resource.ts
import { namedSchema } from "./openapi-helpers";

export const apiMyResourceValidator = namedSchema(
  "MyResource",
  z.object({ id: z.string(), name: z.string() /* ... */ }),
);
```

**What it does:**

- Tags the schema with `.meta({ id: "MyResource" })` so `z.toJSONSchema` emits it as a `$ref` instead of inlining
- Registers the schema in `namedSchemaRegistry` so `generate-openapi.ts` includes it in `components/schemas/` even if it's never referenced as a sub-schema
- Generates a `MyResource_model` tag in the spec with a `<SchemaDefinition>` description for the docs "Models" section

**When to use it:** Only for validators that represent a named API model — typically the `api*Validator` exported from a validator file (e.g., `apiFeatureValidator`, `apiExperimentValidator`). Don't use it for request body schemas, internal sub-schemas, or validators that are only used for validation.

### OpenAPI Spec Generation

The OpenAPI spec is generated from Zod validators by `packages/back-end/src/scripts/generate-openapi.ts`. After making changes to validators or API endpoints, regenerate and commit the updated spec:

```bash
pnpm --filter back-end generate-openapi
```

This rebuilds `shared` first, then produces `generated/spec.yaml` from the Zod validators and route definitions. The generated spec should be committed alongside the code changes.

### Non-BaseModel Endpoints

Some external API endpoints are not backed by a `BaseModel` — for example, ad-hoc RPC-style actions, query/exploration endpoints, or endpoints that orchestrate across multiple models without a single owning resource:

- Create a resource directory under `src/api/` with a `*.router.ts` and individual handler files
- Define Zod validators in `shared/src/validators/` for request/response schemas
- Use `createApiRequestHandler()` with those validators in each handler
- Register the router in `src/api/api.router.ts`

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

### Resolving `ownerEmail` on API Responses

Every external API response that includes an owner-bearing resource must expose a resolved `ownerEmail` alongside the raw `owner` field. Use the helpers in [src/services/owner.ts](../../../packages/back-end/src/services/owner.ts):

- `resolveOwnerEmail(apiDoc, context)` — for a single API doc
- `resolveOwnerEmails(apiDocs, context)` — for a list (batches the DB lookup)

Both are no-ops for docs without a string `owner` field, so they're safe to call unconditionally.

**Spec-based endpoints:** The default `handleApiGet`, `handleApiCreate`, `handleApiList`, and `handleApiUpdate` implementations in `BaseModel` already wrap their return value with the appropriate helper — no action needed unless you override them.

**Overriding `handleApi*`:** When you override one of these methods you replace the base implementation, so call the helper yourself before returning:

```typescript
public override async handleApiList(
  req: Parameters<InstanceType<typeof BaseClass>["handleApiList"]>[0],
): Promise<ApiMyResource[]> {
  const docs = await this._find({ project: req.query.projectId });
  return resolveOwnerEmails(
    docs.map((doc) => this.toApiInterface(doc)),
    this.context,
  );
}
```

**Non-BaseModel endpoints:** Wrap the final API shape at the return statement. Use `resolveOwnerEmails` for lists so the user lookup is batched:

```typescript
// Single doc
return {
  archetype: await resolveOwnerEmail(
    toArchetypeApiInterface(archetype),
    req.context,
  ),
};

// List
return {
  archetypes: await resolveOwnerEmails(
    filtered.map((a) => toArchetypeApiInterface(a)),
    req.context,
  ),
};
```

Call the helper on the final API-shaped object — don't try to look up owner emails inside `toApiInterface` or equivalent serializers, since they're sync and per-doc.

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
