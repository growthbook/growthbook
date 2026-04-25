import { z, ZodType } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { apiBaseSchema } from "shared/validators";
import { capitalizeFirstCharacter } from "shared/util";
import { ModelName } from "back-end/src/services/context";
import {
  ApiRequest,
  RequestSchemas,
  createApiRequestHandler,
  OpenApiRoute,
} from "back-end/src/util/handler";
import {
  CustomApiHandler,
  CrudAction,
  crudActions,
  defaultHandlers,
  HttpVerb,
} from "./apiModelHandlers";

// Avoids TypeScript intersecting all model handler signatures when resolving
// the union returned by context.models[modelKey].
type MinimalApiModel = Record<
  (typeof defaultHandlers)[CrudAction],
  (
    req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ) => Promise<unknown>
>;

export type ApiBaseSchema = typeof apiBaseSchema;
type ApiCreateZodObject<T extends ApiBaseSchema> = z.ZodType<
  CreateProps<z.infer<T>>
>;
type ApiUpdateZodObject<T extends ApiBaseSchema> = z.ZodType<
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
};

/**
 * Lightweight API spec for OpenAPI doc generation.
 * Contains only Zod schemas and metadata — no runtime handler code.
 * Lives in back-end/src/api/specs/ and is imported by the generate script.
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
  /** Human-readable label shown in the docs nav (e.g. "Ramp Schedule Templates"). Defaults to the raw tag name. */
  navDisplayName?: string;
  /** Short description shown under the nav label in the docs. */
  navDescription?: string;
  /** If set, inserts this resource's nav tag immediately after the named tag in the left nav. */
  navAfterTag?: string;
  /** Override the tag used on endpoints. Defaults to capitalizeFirstCharacter(modelPlural). Use when the spec-based model must share a tag with legacy hand-written routes (e.g. "ramp-schedules"). */
  tag?: string;
};

/**
 * Full API config for a model, combining the lightweight OpenAPI spec
 * with runtime concerns (model key, request handlers).
 */
export type ApiModelConfig<
  T extends ApiBaseSchema = ApiBaseSchema,
  C extends
    ApiCreateZodObject<ApiBaseSchema> = ApiCreateZodObject<ApiBaseSchema>,
  U extends
    ApiUpdateZodObject<ApiBaseSchema> = ApiUpdateZodObject<ApiBaseSchema>,
> = {
  modelKey: ModelName;
  openApiSpec: OpenApiModelSpec<T, C, U>;
  customHandlers?: CustomApiHandler[]; // Wrap config object with defineCustomApiHandler for proper type inference
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

function getFullPath(basePath: string, pathFragment: string): string {
  return ("/" + basePath + "/" + pathFragment)
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

export function getOpenApiRoutesForApiConfig(
  apiConfig: ApiModelConfig,
): OpenApiRoute[] {
  const routes: OpenApiRoute[] = [];

  const tag =
    apiConfig.openApiSpec.tag ??
    capitalizeFirstCharacter(apiConfig.openApiSpec.modelPlural);

  const crudConfig = getCrudConfig(apiConfig.openApiSpec);
  crudConfig.forEach(
    ({
      action,
      verb,
      pathFragment,
      validator,
      returnKey,
      returnSchema,
      plural,
      hasResponseOverride,
    }) => {
      const singularCapitalized = capitalizeFirstCharacter(
        apiConfig.openApiSpec.modelSingular,
      );
      const pluralCapitalized = capitalizeFirstCharacter(
        apiConfig.openApiSpec.modelPlural,
      );
      const route = createApiRequestHandler({
        ...validator,
        method: verb,
        path: getFullPath(apiConfig.openApiSpec.pathBase, pathFragment),
        operationId: `${action}${plural ? pluralCapitalized : singularCapitalized}`,
        summary: getDefaultCrudActionSummary(
          action,
          apiConfig.openApiSpec.modelSingular,
          apiConfig.openApiSpec.modelPlural,
        ),
        description: apiConfig.openApiSpec.crudDescriptions?.[action],
        tags: [tag],
        responseSchema: returnSchema,
      })(async (req) => {
        const modelInstance = req.context.models[
          apiConfig.modelKey
        ] as unknown as MinimalApiModel;
        const result = await modelInstance[defaultHandlers[action]](req);
        if (hasResponseOverride) return result as z.infer<typeof returnSchema>;
        return { [returnKey]: result } as z.infer<typeof returnSchema>;
      });
      routes.push(route);
    },
  );

  apiConfig.customHandlers?.forEach(
    ({
      pathFragment,
      validator,
      reqHandler,
      verb,
      operationId,
      summary,
      zodReturnObject,
    }) => {
      const route = createApiRequestHandler({
        ...validator,
        method: verb,
        path: getFullPath(apiConfig.openApiSpec.pathBase, pathFragment),
        operationId,
        summary,
        tags: [tag],
        responseSchema: zodReturnObject,
      })(reqHandler);
      routes.push(route);
    },
  );

  return routes;
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

export function generateYamlForPath({
  path,
  verb,
  validator,
  returnSchema,
  operationId,
  summary = "",
  tags = [],
}: {
  path: string;
  verb: HttpVerb;
  validator: RequestSchemas<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
  returnSchema: object;
  operationId: string;
  summary?: string;
  tags?: string[];
}) {
  const formattedParams: Array<object> = [];
  const { paramsSchema, bodySchema, querySchema } = validator;
  if (paramsSchema instanceof z.ZodObject) {
    const paramsJson = z.toJSONSchema(paramsSchema);
    Object.entries(paramsJson.properties ?? {}).forEach(
      ([paramName, paramInfo]) => {
        if (typeof paramInfo !== "object") return;
        formattedParams.push({
          name: paramName,
          in: "path",
          required: (paramsJson.required ?? []).includes(paramName),
          schema: paramInfo,
        });
      },
    );
  }
  if (querySchema instanceof z.ZodObject) {
    const queryJson = z.toJSONSchema(querySchema);
    Object.entries(queryJson.properties ?? {}).forEach(
      ([paramName, paramInfo]) => {
        if (typeof paramInfo !== "object") return;
        formattedParams.push({
          name: paramName,
          in: "query",
          required: (queryJson.required ?? []).includes(paramName),
          schema: paramInfo,
        });
      },
    );
  }
  let requestBody: object | undefined = undefined;
  if (bodySchema instanceof z.ZodObject) {
    const bodyJson = z.toJSONSchema(bodySchema);
    requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: bodyJson,
        },
      },
    };
  }
  return {
    $skipValidatorGeneration: true,
    parameters: formattedParams,
    tags: tags,
    summary,
    operationId,
    "x-codeSamples": [
      {
        lang: "cURL",
        source: `curl -X ${verb.toLocaleUpperCase()} https://api.growthbook.io/api/v1${path} ${requestBody ? "-d '{ ... }' " : ""}-u secret_abc123DEF456`,
      },
    ],
    requestBody,
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: returnSchema,
          },
        },
      },
    },
  };
}
