import { z, ZodType } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { apiBaseSchema } from "./validators/base-model";
import { ApiErrorCode } from "./validators/api-errors";
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
      responseSchema?: ZodType;
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
 * Lightweight API spec for OpenAPI doc generation.
 * Contains only Zod schemas and metadata — no runtime handler code.
 * Lives in back-end/src/api/specs/ (or shared/src/validators/ when the
 * front-end needs it) and is mounted through the model's apiConfig.
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
  crudActions?: CrudAction[];
  crudValidatorOverrides?: CrudValidatorOverrides;
  customEndpoints?: OpenApiEndpointSpec[];
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

const crudDefaults: Record<
  CrudAction,
  { verb: HttpVerb; pathFragment: string; plural?: boolean }
> = {
  get: {
    verb: "get",
    pathFragment: "/:id",
  },
  create: {
    verb: "post",
    pathFragment: "",
  },
  list: {
    verb: "get",
    pathFragment: "",
    plural: true,
  },
  delete: {
    verb: "delete",
    pathFragment: "/:id",
  },
  update: {
    verb: "put",
    pathFragment: "/:id",
  },
};
type CrudActionConfig<A extends CrudAction = CrudAction> = {
  action: A;
  verb: HttpVerb;
  pathFragment: string;
  validator: RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
  returnKey: string;
  returnSchema: ZodType;
  plural: boolean | undefined;
  hasResponseOverride: boolean;
};
export function getCrudConfig(spec: OpenApiModelSpec): CrudActionConfig[] {
  const actions = spec.includeDefaultCrud
    ? crudActions
    : (spec.crudActions ?? []);
  return actions.map((action) => {
    const { verb, pathFragment, plural } = crudDefaults[action];
    const validator = getCrudValidator(action, spec);
    const returnKey =
      action === "delete"
        ? "deletedId"
        : plural
          ? spec.modelPlural
          : spec.modelSingular;
    const overrideResponse =
      spec.crudValidatorOverrides?.[action]?.responseSchema;
    const returnSchema =
      overrideResponse ??
      z.object({
        [returnKey]:
          action === "delete"
            ? z.string()
            : plural
              ? z.array(spec.apiInterface)
              : spec.apiInterface,
      });
    return {
      action,
      verb,
      pathFragment,
      validator,
      returnKey,
      returnSchema,
      plural,
      hasResponseOverride: !!overrideResponse,
    };
  });
}

export function getFullPath(basePath: string, pathFragment: string): string {
  return ("/" + basePath + "/" + pathFragment)
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

export function getCrudValidator(
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

export function getDefaultCrudActionSummary(
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
