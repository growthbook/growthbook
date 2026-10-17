# How to migrate REST endpoints to shared

Read this when a front-end caller needs a typed definition for a GrowthBook `/api/v1/*` or `/api/v2/*` endpoint, including when `local/no-rest-api-path` flags a raw URL. The definition must describe the route the back-end actually mounts and supply its request and response schemas.

Sharing a definition does not require changing the endpoint's URL, API version, model, permissions, or behavior. Internal API routes such as `/features` still use `useApi` and `apiCall`; this guide is for the public REST API.

## Choose the migration

| What exists today                                                    | What to do                                                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A complete endpoint in `shared/validators` or `shared/api-endpoints` | Reuse it directly. A name ending in `Validator` can already be a complete endpoint.                        |
| A legacy handler with its endpoint definition on the back-end        | Move the definition into `shared/api-endpoints`, then have the handler and front-end import it.            |
| A BaseModel spec that generates the route                            | Move the model's spec into shared if needed, then export the result of `crudEndpoint` or `customEndpoint`. |

Search for the route's `operationId`, path, and handler before creating an export. Request-only validators are not complete endpoints: they lack the final path, method, and response schema.

## Resolve the full path first

The current REST API composes URLs in these places:

| Part             | Owner                                                                        | Example                                   |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------------------- |
| API host         | Front-end `fetchRaw` in `services/auth.tsx`                                  | `https://api.growthbook.io`               |
| Public API mount | Back-end `src/app.ts`                                                        | `/api`                                    |
| Version          | Central `src/api/api.router.ts`, from `endpoint.version`, defaulting to `v1` | `/v1`                                     |
| Resource path    | `endpoint.path`                                                              | `/contextual-bandits/:id/events/:eventId` |

The front-end's `services/restApi.ts` builds `/api/${version}${path}` with the same default version, substitutes encoded path parameters, and serializes query arguments. The endpoint's `path` must start with `/` and include the entire resource path, with no host, `/api`, version prefix, or query string.

Resource files such as `src/api/contextual-bandits/contextual-bandits.router.ts` export arrays of route definitions. Their directory names do not add URL prefixes. The central `allRoutes` registration loop mounts each definition at `/${version}${path}` under `/api`.

BaseModel helpers compose the resource path first. For example, `pathBase: "/teams"` and `pathFragment: "/:id"` produce `path: "/teams/:id"`, so the final URL is `/api/v1/teams/:id`. Export the composed endpoint; passing the fragment alone to the front-end would request `/api/v1/:id`.

If a legacy route uses actual nested Express routers, trace every `app.use` and `router.use` mount. For example, mounting a child at `/widgets` with `get("/:id")` under `/api/v1` gives `/api/v1/widgets/:id`; the shared definition needs `path: "/widgets/:id"`. Route metadata does not discover or inherit these prefixes automatically. Public REST endpoints migrated to the shared pattern must be registered through `allRoutes` with the complete resource path, preserving middleware, permissions, and route ordering and removing the old registration. Do not mount that complete path under `/widgets` again.

The OpenAPI generation check compares exported endpoint metadata with `allRoutes` by method, path, operationId, and version. It does not walk arbitrary Express router trees, verify the top-level `/api` mount, or prove that separately copied schemas are equal. Internal, SCIM, and vendor routes use different mounts and should not be passed to `useRestApi`.

## 1. Reuse a complete shared endpoint

`getQueryValidator` in `shared/validators/queries.ts` already has request schemas, a response schema, method, path, and operationId. The back-end passes it directly to `createApiRequestHandler`. Despite its name, it is ready for the typed front-end helper:

```typescript
import { getQueryValidator } from "shared/validators";
import { useRestApi } from "@/services/restApi";

const { data, mutate } = useRestApi(
  getQueryValidator,
  queryId ? { params: { id: queryId } } : null,
);
// data?.query is inferred from getQueryValidator.responseSchema.
```

No new endpoint object or duplicate response interface is needed. Keep existing shared endpoints where they are unless there is a separate reason to move them.

## 2. Move a legacy handler's definition into shared

This illustrative migration uses a widget endpoint. Substitute the existing route's schemas and metadata. `handler` below stands for the existing handler callback, whose implementation stays on the back-end.

Before, the back-end owns the complete definition:

```typescript
// packages/back-end/src/api/widgets/getWidget.ts
export const getWidget = createApiRequestHandler({
  paramsSchema: z.object({ id: z.string() }).strict(),
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ widget: apiWidgetValidator }).strict(),
  method: "get",
  path: "/widgets/:id",
  operationId: "getWidget",
  summary: "Get a widget",
  tags: ["widgets"],
})(handler);

// Front-end, with a manually maintained response type and URL:
const { data } = useApi<{ widget: ApiWidget }>(`/api/v1/widgets/${id}`);
```

Move the definition into a resource module. Move any back-end-only request/response schemas into `shared/validators` as well; shared must never import from the back-end.

```typescript
// packages/shared/src/api-endpoints/widgets.ts
import { z } from "zod";
import { apiWidgetValidator } from "../validators/widgets";

export const getWidget = {
  paramsSchema: z.object({ id: z.string() }).strict(),
  bodySchema: z.never(),
  querySchema: z.never(),
  responseSchema: z.object({ widget: apiWidgetValidator }).strict(),
  method: "get" as const,
  path: "/widgets/:id",
  operationId: "getWidget",
  summary: "Get a widget",
  tags: ["widgets"],
};

// packages/shared/src/api-endpoints/index.ts
export * as widgetEndpoints from "./widgets";
```

Preserve existing descriptions, tags, examples, and `excludeFromSpec` metadata. Keep `version: "v2" as const` for an existing v2 route; an omitted version means v1. Preserve back-end-only metadata such as middleware, deprecation settings, and possible errors at the handler call site. Use a response schema for the actual JSON response, including its wrapper keys and serialized dates. Do not replace an unknown response shape with `z.any()` to get the migration to compile.

Import the definition on both sides:

```typescript
// packages/back-end/src/api/widgets/getWidget.ts
import { widgetEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getWidget = createApiRequestHandler(widgetEndpoints.getWidget)(
  handler,
);

// Front-end
import { widgetEndpoints } from "shared/api-endpoints";
import { useRestApi } from "@/services/restApi";

const { data, mutate } = useRestApi(widgetEndpoints.getWidget, {
  params: { id },
});
```

Keep the real callback in place so `createApiRequestHandler` infers its request and return types from the shared schemas. If the handler has middleware, use `createApiRequestHandler({ ...widgetEndpoints.getWidget, middleware: [...] })`. Do not override the endpoint's path, method, version, or schemas at the call site.

The back-end route must remain in its resource's route array, which must be included in `src/api/api.router.ts`'s `allRoutes`. Exporting a shared definition alone does not register a route. Preserve ordering when literal routes such as `/latest` coexist with parameter routes.

For writes, use `useRestApiCall()` with the shared endpoint and `{ params, body, query }` as applicable. Pass the body as an object rather than JSON-stringifying it. The endpoint schemas infer both arguments and the returned data. Retain the caller's cache refresh behavior; see [front-end data fetching](../frontend/data-fetching.md).

## 3. Export endpoints generated by a BaseModel spec

BaseModel specs hold `pathBase`, enabled CRUD actions, and custom `pathFragment` values. Their nested validators are only request schemas, not callable endpoints.

1. Move the model's spec and custom endpoint definitions from `back-end/src/api/specs/` into `shared/src/validators/` if they are not already shared. Move referenced schemas too, keeping runtime handlers and model imports on the back-end.
2. Declare the shared model spec `as const satisfies OpenApiModelSpec` from `shared/api-model` so response keys and enabled actions retain literal types.
3. Keep the back-end `src/api/specs/*.spec.ts` module as a re-export with a default export for spec discovery. Have the model's `apiConfig.openApiSpec` reference that same spec, and its `customHandlers` use the same custom definitions.
4. Export only enabled, mounted endpoints from a `shared/api-endpoints` module and add its namespace export to `api-endpoints/index.ts`.

For example, the existing Contextual Bandit definitions are used this way:

```typescript
import { crudEndpoint, customEndpoint } from "../api-model";
import {
  contextualBanditApiSpec,
  startContextualBanditEndpoint,
} from "../validators/contextual-bandit.spec";

export const getContextualBandit = crudEndpoint(contextualBanditApiSpec, "get");
export const startContextualBandit = customEndpoint(
  contextualBanditApiSpec,
  startContextualBanditEndpoint,
);
```

`crudEndpoint` and `customEndpoint` produce the complete resource path and response schema used by both the back-end route builder and front-end helpers. Do not add endpoint metadata to a custom endpoint's `validator` or to `crudValidatorOverrides`; `NoEndpointFields` rejects it because the surrounding route supplies those fields. A CRUD override may supply `responseSchema` when the handler returns a custom response.

Ensure the model remains in `API_MODELS` and each custom endpoint has a registered handler. The shared `customEndpoints` list alone does not mount a handler. See [back-end API patterns](api-patterns.md) for model configuration.

## Verify the migration

- Run type-checks for shared, back-end, and front-end. Remove obsolete manually declared response types and raw REST path strings from migrated callers.
- Run ESLint on changed code. Suppress `local/no-rest-api-path` only for legitimate non-request or vendor literals, with a reason on the affected line.
- Run `pnpm generate-openapi`. It builds shared and requires exported endpoints from `shared/api-endpoints` and complete endpoint objects from the `shared/validators` barrel to match exactly one registered route. Export resource modules from their barrel so the check can see them.
- Inspect generated changes. Moving a definition should preserve the public contract. Exercise the caller against the application and verify the URL, response shape, and any cache refresh after a write.
