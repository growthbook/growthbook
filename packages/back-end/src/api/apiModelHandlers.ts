import { z } from "zod";
import { ApiErrorCode } from "shared/validators";
import { apiHttpVerbs, HttpVerb } from "shared/api-spec";
import {
  ApiBaseSchema,
  ApiCreateZodObject,
  ApiUpdateZodObject,
  CrudAction,
  crudEndpoint,
  customEndpoint,
  getCrudReturnKey,
  getEnabledCrudActions,
  OpenApiModelSpec,
} from "shared/api-model";
import { ModelName } from "back-end/src/services/context";
import {
  ApiRequest,
  BackEndApiEndpointSpec,
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
  const spec = apiConfig.openApiSpec;

  getEnabledCrudActions(spec).forEach((action) => {
    const endpoint: BackEndApiEndpointSpec<
      z.ZodTypeAny,
      z.ZodTypeAny,
      z.ZodTypeAny,
      z.ZodTypeAny
    > = crudEndpoint(spec, action);
    const returnKey = getCrudReturnKey(spec, action);
    const hasResponseOverride =
      !!spec.crudValidatorOverrides?.[action]?.responseSchema;
    const route = createApiRequestHandler(endpoint)(async (req) => {
      const modelInstance = req.context.models[
        apiConfig.modelKey
      ] as unknown as MinimalApiModel;
      const result = await modelInstance[defaultHandlers[action]](req);
      if (hasResponseOverride) return result;
      return { [returnKey]: result };
    });
    routes.push(route);
  });

  apiConfig.customHandlers?.forEach((handler) => {
    const route = createApiRequestHandler(customEndpoint(spec, handler))(
      handler.reqHandler,
    );
    routes.push(route);
  });

  return routes;
}
