import { z } from "zod";
import { ApiErrorCode } from "shared/validators";
import { apiHttpVerbs, HttpVerb } from "shared/api-spec";
import {
  ApiBaseSchema,
  ApiCreateZodObject,
  ApiUpdateZodObject,
  CrudAction,
  getCrudConfig,
  getDefaultCrudActionSummary,
  getFullPath,
  OpenApiModelSpec,
} from "shared/api-model";
import { capitalizeFirstCharacter } from "shared/util";
import { ModelName } from "back-end/src/services/context";
import {
  ApiRequest,
  RequestSchemas,
  createApiRequestHandler,
  OpenApiRoute,
} from "back-end/src/util/handler";

export { apiHttpVerbs };
export type { HttpVerb };

export const defaultHandlers = {
  get: "handleApiGet",
  create: "handleApiCreate",
  list: "handleApiList",
  delete: "handleApiDelete",
  update: "handleApiUpdate",
} as const;

export type CustomApiHandler<
  ParamsSchema extends z.ZodType = z.ZodTypeAny,
  BodySchema extends z.ZodType = z.ZodTypeAny,
  QuerySchema extends z.ZodType = z.ZodTypeAny,
  ReturnShape extends z.ZodType = z.ZodTypeAny,
> = {
  pathFragment: string;
  verb: HttpVerb;
  operationId: string;
  validator: RequestSchemas<ParamsSchema, BodySchema, QuerySchema>;
  zodReturnObject: ReturnShape;
  summary: string; // For generating docs, e.g. "Get all dashboards for an experiment"
  description?: string;
  version?: "v1" | "v2";
  /** Error codes this endpoint may throw, used to generate OpenAPI error response schemas. */
  possibleErrors?: readonly ApiErrorCode[];
  reqHandler: (
    req: ApiRequest<
      z.infer<ReturnShape>,
      ParamsSchema,
      BodySchema,
      QuerySchema
    >,
    // You'll likely need to add an explicit type annotation for the return shape because of a type inference cycle
  ) => Promise<z.infer<ReturnShape>>;
};

export function defineCustomApiHandler<
  ParamsSchema extends z.ZodType,
  BodySchema extends z.ZodType,
  QuerySchema extends z.ZodType,
  ReturnShape extends z.ZodType,
>(
  handler: CustomApiHandler<ParamsSchema, BodySchema, QuerySchema, ReturnShape>,
): typeof handler {
  return handler;
}

// Avoids TypeScript intersecting all model handler signatures when resolving
// the union returned by context.models[modelKey].
type MinimalApiModel = Record<
  (typeof defaultHandlers)[CrudAction],
  (
    req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
  ) => Promise<unknown>
>;

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
      const deprecationDate = apiConfig.openApiSpec.crudDeprecations?.[action];
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
        deprecated: deprecationDate !== undefined,
        deprecationDate,
        tags: [tag],
        responseSchema: returnSchema,
        possibleErrors: apiConfig.openApiSpec.possibleErrors?.[action],
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
      description,
      zodReturnObject,
      possibleErrors,
      version,
    }) => {
      const route = createApiRequestHandler({
        ...validator,
        method: verb,
        path: getFullPath(apiConfig.openApiSpec.pathBase, pathFragment),
        operationId,
        summary,
        description,
        tags: [tag],
        responseSchema: zodReturnObject,
        possibleErrors,
        version,
      })(reqHandler);
      routes.push(route);
    },
  );

  return routes;
}
