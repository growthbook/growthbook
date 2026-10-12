import { z } from "zod";
import type { CreateProps, UpdateProps } from "shared/types/base-model";
import type { apiBaseSchema } from "./validators/base-model";
import type { ApiErrorCode } from "./validators/api-errors";
import { capitalizeFirstCharacter } from "./util";
import { HttpVerb, RequestSchemas } from "./api-spec";

export const crudActions = [
  "get",
  "create",
  "list",
  "delete",
  "update",
] as const;
export type CrudAction = (typeof crudActions)[number];

export type ApiBaseSchema = typeof apiBaseSchema;
export type ApiCreateZodObject<T extends ApiBaseSchema> = z.ZodType<
  CreateProps<z.infer<T>>
>;
export type ApiUpdateZodObject<T extends ApiBaseSchema> = z.ZodType<
  UpdateProps<z.infer<T>>
>;
/**
 * The actual default validators used when no crudValidatorOverride is specified.
 * Single source of truth for default schemas — types are inferred from these values
 * via DefaultCrudValidators.
 * Body schemas for create/update are wide (z.unknown) because the model-specific
 * schema is applied at routing time by getDefaultValidator.
 */
const defaultCrudValidators = {
  get: {
    paramsSchema: z.object({ id: z.string() }).strict(),
    bodySchema: z.never(),
    querySchema: z.never(),
  },
  create: {
    paramsSchema: z.never(),
    bodySchema: z.unknown(), // overridden per-model at routing time
    querySchema: z.never(),
  },
  list: {
    paramsSchema: z.never(),
    bodySchema: z.never(),
    querySchema: z.never(), // TODO: pagination?
  },
  delete: {
    paramsSchema: z.object({ id: z.string() }).strict(),
    bodySchema: z.never(),
    querySchema: z.never(),
  },
  update: {
    paramsSchema: z.object({ id: z.string() }).strict(),
    bodySchema: z.unknown(), // overridden per-model at routing time
    querySchema: z.never(),
  },
} satisfies Record<
  CrudAction,
  RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>
>;

/** Narrow type derived from the default CRUD validators, used as fallback in ExtractCrudSchema. */
export type DefaultCrudValidators = typeof defaultCrudValidators;

/** Wide type constraining crudValidatorOverrides — allows any Zod schema for each slot. */
export type CrudValidatorOverrides = Partial<
  Record<
    CrudAction,
    RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny> & {
      responseSchema?: z.ZodType;
    }
  >
>;

/**
 * Spec-only definition for a custom API endpoint, used for OpenAPI doc generation.
 * Does NOT include reqHandler — that stays in the model's customHandlers.
 */
export type OpenApiEndpointSpec = {
  pathFragment: string;
  verb: HttpVerb;
  operationId: string;
  validator: RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
  zodReturnObject: z.ZodTypeAny;
  summary: string;
  description?: string;
  version?: "v1" | "v2";
  /** Error codes this endpoint may throw, used to generate OpenAPI error response schemas. */
  possibleErrors?: readonly ApiErrorCode[];
};

/**
 * Lightweight API spec for a BaseModel's REST endpoints.
 * Contains only Zod schemas and metadata — no runtime handler code.
 * The back-end mounts it through the model's `apiConfig`; `crudEndpoint` and
 * `customEndpoint` turn it into endpoints the front-end can call. Declare it
 * `as const satisfies OpenApiModelSpec` when the front-end needs those
 * endpoints, so the response keys keep their literal types.
 *
 * C/U don't extend from T to prevent restrictions on the actual body shapes
 * Concrete body types are inferred from the actual model config
 */
export type OpenApiModelSpec<
  T extends ApiBaseSchema = ApiBaseSchema,
  C extends
    ApiCreateZodObject<ApiBaseSchema> = ApiCreateZodObject<ApiBaseSchema>,
  U extends
    ApiUpdateZodObject<ApiBaseSchema> = ApiUpdateZodObject<ApiBaseSchema>,
> = {
  modelSingular: string;
  modelPlural: string;
  apiInterface: T;
  schemas: {
    createBody: C;
    updateBody: U;
  };
  pathBase: string;
  includeDefaultCrud?: boolean;
  crudActions?: readonly CrudAction[];
  crudValidatorOverrides?: CrudValidatorOverrides;
  customEndpoints?: readonly OpenApiEndpointSpec[];
  /** Per-CRUD-action descriptions (longer form text shown below the summary in docs). */
  crudDescriptions?: Partial<Record<CrudAction, string>>;
  /** Marks CRUD actions deprecated. Values are RFC 8594 `Deprecation` header values (`"true"` or `"@<unix-timestamp>"`). */
  crudDeprecations?: Partial<Record<CrudAction, string>>;
  /** Error codes that may be thrown by CRUD actions, used to generate OpenAPI error response schemas. */
  possibleErrors?: Partial<Record<CrudAction, readonly ApiErrorCode[]>>;
  /** Human-readable label shown in the docs nav (e.g. "Ramp Schedule Templates"). Defaults to the raw tag name. */
  navDisplayName?: string;
  /** Short description shown under the nav label in the docs. */
  navDescription?: string;
  /** If set, inserts this resource's nav tag immediately after the named tag in the left nav. */
  navAfterTag?: string;
  /** Override the tag used on endpoints. Defaults to capitalizeFirstCharacter(modelPlural). Use when the spec-based model must share a tag with legacy hand-written routes (e.g. "ramp-schedules"). */
  tag?: string;
};

const crudRoutes = {
  get: { method: "get", pathFragment: "/:id" },
  create: { method: "post", pathFragment: "" },
  list: { method: "get", pathFragment: "" },
  delete: { method: "delete", pathFragment: "/:id" },
  update: { method: "put", pathFragment: "/:id" },
} as const satisfies Record<
  CrudAction,
  { method: HttpVerb; pathFragment: string }
>;

/** The CRUD actions a spec mounts; every action when the spec's type is too wide to tell. */
export type EnabledCrudAction<S extends OpenApiModelSpec> = S extends {
  includeDefaultCrud: true;
}
  ? CrudAction
  : S extends { crudActions: readonly (infer A extends CrudAction)[] }
    ? A
    : OpenApiModelSpec extends S
      ? CrudAction
      : never;

type CrudOverride<
  S extends OpenApiModelSpec,
  A extends CrudAction,
> = S extends { crudValidatorOverrides: Record<A, infer O> } ? O : null;

type CrudSlot<
  S extends OpenApiModelSpec,
  A extends CrudAction,
  K extends keyof RequestSchemas<unknown, unknown, unknown>,
> =
  CrudOverride<S, A> extends null
    ? K extends "bodySchema"
      ? A extends "create"
        ? S["schemas"]["createBody"]
        : A extends "update"
          ? S["schemas"]["updateBody"]
          : DefaultCrudValidators[A][K]
      : DefaultCrudValidators[A][K]
    : CrudOverride<S, A> extends Record<K, infer V>
      ? V
      : undefined;

type CrudReturnKey<
  S extends OpenApiModelSpec,
  A extends CrudAction,
> = A extends "delete"
  ? "deletedId"
  : A extends "list"
    ? S["modelPlural"]
    : S["modelSingular"];

type CrudResponse<S extends OpenApiModelSpec, A extends CrudAction> =
  CrudOverride<S, A> extends { responseSchema: infer R }
    ? R
    : z.ZodObject<{
        [K in CrudReturnKey<S, A>]: A extends "delete"
          ? z.ZodString
          : A extends "list"
            ? z.ZodArray<S["apiInterface"]>
            : S["apiInterface"];
      }>;

export type CrudEndpoint<S extends OpenApiModelSpec, A extends CrudAction> = {
  paramsSchema: CrudSlot<S, A, "paramsSchema">;
  bodySchema: CrudSlot<S, A, "bodySchema">;
  querySchema: CrudSlot<S, A, "querySchema">;
  responseSchema: CrudResponse<S, A>;
  method: (typeof crudRoutes)[A]["method"];
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  deprecated: boolean;
  deprecationDate?: string;
  tags: string[];
  possibleErrors?: readonly ApiErrorCode[];
};

function getFullPath(basePath: string, pathFragment: string): string {
  return ("/" + basePath + "/" + pathFragment)
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

export function getApiModelTag(spec: OpenApiModelSpec): string {
  return spec.tag ?? capitalizeFirstCharacter(spec.modelPlural);
}

export function getEnabledCrudActions(
  spec: OpenApiModelSpec,
): readonly CrudAction[] {
  return spec.includeDefaultCrud ? crudActions : (spec.crudActions ?? []);
}

/** The key a default CRUD handler's result is returned under. */
export function getCrudReturnKey(
  spec: OpenApiModelSpec,
  action: CrudAction,
): string {
  if (action === "delete") return "deletedId";
  return action === "list" ? spec.modelPlural : spec.modelSingular;
}

/**
 * The endpoint the back-end mounts for one CRUD action of a spec. `action`
 * must be one the spec enables, so dropping it from the spec breaks callers.
 */
export function crudEndpoint<
  S extends OpenApiModelSpec,
  A extends EnabledCrudAction<S>,
>(spec: S, action: A): CrudEndpoint<S, A> {
  const { method, pathFragment } = crudRoutes[action];
  const plural = action === "list";
  const deprecationDate = spec.crudDeprecations?.[action];
  // The response key is computed at runtime, so the cast is what carries the
  // literal key (and the per-action schemas) that CrudEndpoint spells out.
  return {
    ...getCrudValidator(action, spec),
    responseSchema:
      spec.crudValidatorOverrides?.[action]?.responseSchema ??
      z.object({
        [getCrudReturnKey(spec, action)]:
          action === "delete"
            ? z.string()
            : plural
              ? z.array(spec.apiInterface)
              : spec.apiInterface,
      }),
    method,
    path: getFullPath(spec.pathBase, pathFragment),
    operationId: `${action}${capitalizeFirstCharacter(
      plural ? spec.modelPlural : spec.modelSingular,
    )}`,
    summary: getDefaultCrudActionSummary(
      action,
      spec.modelSingular,
      spec.modelPlural,
    ),
    description: spec.crudDescriptions?.[action],
    deprecated: deprecationDate !== undefined,
    deprecationDate,
    tags: [getApiModelTag(spec)],
    possibleErrors: spec.possibleErrors?.[action],
  } as CrudEndpoint<S, A>;
}

export type CustomEndpoint<E extends OpenApiEndpointSpec> = E["validator"] & {
  responseSchema: E["zodReturnObject"];
  method: E["verb"];
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  possibleErrors?: readonly ApiErrorCode[];
  version?: "v1" | "v2";
};

/** The endpoint the back-end mounts for one of a spec's custom endpoints. */
export function customEndpoint<E extends OpenApiEndpointSpec>(
  spec: OpenApiModelSpec,
  endpoint: E,
): CustomEndpoint<E> {
  return {
    ...endpoint.validator,
    responseSchema: endpoint.zodReturnObject,
    method: endpoint.verb,
    path: getFullPath(spec.pathBase, endpoint.pathFragment),
    operationId: endpoint.operationId,
    summary: endpoint.summary,
    description: endpoint.description,
    tags: [getApiModelTag(spec)],
    possibleErrors: endpoint.possibleErrors,
    version: endpoint.version,
  };
}

function getCrudValidator(
  action: CrudAction,
  spec: OpenApiModelSpec,
): RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny> {
  return (
    spec.crudValidatorOverrides?.[action] ??
    getDefaultValidator(
      action,
      spec.schemas.createBody,
      spec.schemas.updateBody,
    )
  );
}

function getDefaultValidator(
  action: CrudAction,
  createBodySchema: z.ZodTypeAny,
  updateBodySchema: z.ZodTypeAny,
): RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny> {
  const base = defaultCrudValidators[action];
  if (action === "create") return { ...base, bodySchema: createBodySchema };
  if (action === "update") return { ...base, bodySchema: updateBodySchema };
  return base;
}

function getDefaultCrudActionSummary(
  action: CrudAction,
  modelSingular: string,
  modelPlural: string,
): string {
  switch (action) {
    case "create":
      return `Create a single ${modelSingular}`;
    case "delete":
      return `Delete a single ${modelSingular}`;
    case "get":
      return `Get a single ${modelSingular}`;
    case "list":
      return `Get all ${modelPlural}`;
    case "update":
      return `Update a single ${modelSingular}`;
  }
}
