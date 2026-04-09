import { Request, RequestHandler, Router } from "express";
import { z, ZodType, ZodNever, output } from "zod";
import { ApiPaginationFields } from "shared/types/openapi";
import { UserInterface } from "shared/types/user";
import { OrganizationInterface } from "shared/types/organization";
import { HttpVerb } from "back-end/src/api/apiModelHandlers";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiErrorResponse, ApiRequestLocals } from "back-end/types/api";
import { IS_MULTI_ORG } from "./secrets";

export type ApiRequest<
  ResponseType = never,
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
> = ApiRequestLocals &
  Request<
    z.infer<ParamsSchema>,
    { status: number } & ResponseType,
    z.infer<BodySchema>,
    z.infer<QuerySchema>
  >;

export type ExampleRequest<
  Params = unknown,
  Body = unknown,
  Query = unknown,
  Response = unknown,
> = {
  params?: Params;
  body?: Body;
  query?: Query;
  response?: Response;
};

export type ApiRequestValidator<
  ParamsSchema,
  BodySchema,
  QuerySchema,
  ResponseSchema,
> = {
  bodySchema?: BodySchema;
  querySchema?: QuerySchema;
  paramsSchema?: ParamsSchema;
  responseSchema: ResponseSchema;
  summary: string;
  operationId: string;
  tags?: string[];
  exampleRequest?: ExampleRequest<
    z.infer<ParamsSchema>,
    z.infer<BodySchema>,
    z.infer<QuerySchema>,
    z.infer<ResponseSchema>
  >;
};

function validate<T extends ZodType>(
  schema: T,
  value: unknown,
):
  | {
      success: true;
      data: output<T>;
    }
  | {
      success: false;
      errors: string[];
    } {
  const result = schema.safeParse(value);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((i) => {
        return "[" + i.path.join(".") + "] " + i.message;
      }),
    };
  }

  return {
    success: true,
    data: result.data,
  };
}

export type WrappedRequestHandler<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
> = RequestHandler<
  z.infer<ParamsSchema>,
  ApiErrorResponse | z.infer<ResponseSchema>,
  z.infer<BodySchema>,
  z.infer<QuerySchema>
>;

export function createApiRequestHandler<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
>({
  paramsSchema,
  bodySchema,
  querySchema,
}: ApiRequestValidator<ParamsSchema, BodySchema, QuerySchema, ResponseSchema>) {
  return (
    handler: (
      req: ApiRequest<
        z.infer<ResponseSchema>,
        ParamsSchema,
        BodySchema,
        QuerySchema
      >,
    ) => Promise<z.infer<ResponseSchema>>,
  ) => {
    const wrappedHandler: WrappedRequestHandler<
      ParamsSchema,
      BodySchema,
      QuerySchema,
      ResponseSchema
    > = async (req, res, next) => {
      try {
        const allErrors: string[] = [];
        if (paramsSchema && !(paramsSchema instanceof ZodNever)) {
          const validated = validate(paramsSchema, req.params);
          if (!validated.success) {
            allErrors.push(`Request params: ` + validated.errors.join(", "));
          } else {
            req.params = validated.data as z.output<ParamsSchema>;
          }
        }
        if (querySchema && !(querySchema instanceof ZodNever)) {
          const validated = validate(querySchema, req.query);
          if (!validated.success) {
            allErrors.push(`Querystring: ` + validated.errors.join(", "));
          } else {
            req.query = validated.data;
          }
        }
        if (bodySchema && !(bodySchema instanceof ZodNever)) {
          const validated = validate(bodySchema, req.body);
          if (!validated.success) {
            allErrors.push(`Request body: ` + validated.errors.join(", "));
          } else {
            req.body = validated.data;
          }
        }
        if (allErrors.length > 0) {
          return res.status(400).json({
            message: allErrors.join("\n"),
          });
        }

        try {
          const result = await handler(
            req as ApiRequest<
              ApiErrorResponse | z.infer<ResponseSchema>,
              ParamsSchema,
              BodySchema,
              QuerySchema
            >,
          );
          return res.status(200).json(result);
        } catch (e) {
          return res.status(e.status || 400).json({
            message: e.message,
          });
        }
      } catch (e) {
        next(e);
      }
    };
    return wrappedHandler;
  };
}

/**
 * Schema metadata for a single route, stored in the registry for OpenAPI generation.
 * Does not include the handler — only the shapes needed to build the spec.
 */
export type RouteSpec = {
  verb: HttpVerb;
  path: string;
  paramsSchema?: ZodType;
  bodySchema?: ZodType;
  querySchema?: ZodType;
  responseSchema: ZodType;
  summary: string;
  operationId: string;
  tags?: string[];
  exampleRequest?: ExampleRequest;
};

/**
 * Wide route config type used in `createOpenApiRouter` arrays. Use `defineRoute` at
 * each call site for narrow type-checking of the handler against its schemas.
 *
 * The handler uses the bivarianceHack so that specific handler types (e.g. a handler
 * whose req.params is `{ id: string }`) remain assignable to this wide type under
 * strictFunctionTypes.
 */
export type AnyRouteConfig = ApiRequestValidator<
  ZodType,
  ZodType,
  ZodType,
  ZodType
> & {
  responseSchema: ZodType;
  summary: string;
  operationId: string;
  handler: {
    bivarianceHack(
      req: ApiRequest<unknown, ZodType, ZodType, ZodType>,
    ): Promise<unknown>;
  }["bivarianceHack"];
};

/**
 * Type-safe route config builder. Pass a validator config (schemas + metadata) plus a
 * `handler` whose `req` types are inferred from the schemas. Returns `AnyRouteConfig`
 * for use in `createOpenApiRouter`.
 */
export function defineRoute<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
>(
  config: ApiRequestValidator<
    ParamsSchema,
    BodySchema,
    QuerySchema,
    ResponseSchema
  > & {
    handler: (
      req: ApiRequest<
        z.infer<ResponseSchema>,
        ParamsSchema,
        BodySchema,
        QuerySchema
      >,
    ) => Promise<z.infer<ResponseSchema>>;
  },
): AnyRouteConfig {
  return config as unknown as AnyRouteConfig;
}

export type Route = readonly [HttpVerb, path: string, AnyRouteConfig];

/** Mount path for Express: `basePath` + relative `routePath` (e.g. `/archetypes` + `/` → `/archetypes`). */
function joinOpenApiMountedPath(basePath: string, routePath: string): string {
  const normBase = basePath.trim();
  const base =
    normBase === "" || normBase === "/"
      ? ""
      : (normBase.startsWith("/") ? normBase : `/${normBase}`).replace(
          /\/+$/,
          "",
        );
  const rel =
    routePath === "/" || routePath === ""
      ? ""
      : routePath.startsWith("/")
        ? routePath
        : `/${routePath}`;
  if (base === "") {
    return rel === "" ? "/" : rel;
  }
  return rel === "" ? base : `${base}${rel}`;
}

export type TagMeta = {
  name: string;
  "x-displayName"?: string;
  description?: string;
};

const __openApiRouters: {
  basePath: string;
  routes: RouteSpec[];
  tagMeta?: TagMeta;
}[] = [];
export function getAllRegisteredOpenApiRouters() {
  return __openApiRouters;
}

export function registerOpenApiRouter(
  basePath: string,
  routes: RouteSpec[],
  tagMeta?: TagMeta,
) {
  __openApiRouters.push({ basePath, routes, tagMeta });
}

/**
 * Creates an Express router with routes pre-mounted under `basePath`, and registers
 * schema metadata with the OpenAPI spec registry. Each route is defined via `defineRoute`
 * for type-safe handler typing. Mount with `app.use(router)` — basePath is already baked in.
 */
export function createOpenApiRouter(
  basePath: string,
  routes: readonly Route[],
  tagMeta?: TagMeta,
): Router {
  const router = Router();
  const routeSpecs: RouteSpec[] = [];

  routes.forEach(([verb, routePath, config]) => {
    const { handler, ...spec } = config;
    const wrappedHandler = createApiRequestHandler(spec)(
      handler as (
        req: ApiRequest<unknown, ZodType, ZodType, ZodType>,
      ) => Promise<unknown>,
    );
    router[verb](joinOpenApiMountedPath(basePath, routePath), wrappedHandler);
    routeSpecs.push({
      verb,
      path: routePath,
      // Exclude ZodNever schemas — they mean "not applicable" and should not
      // appear in the generated spec as parameters/body.
      paramsSchema:
        spec.paramsSchema instanceof ZodNever ? undefined : spec.paramsSchema,
      bodySchema:
        spec.bodySchema instanceof ZodNever ? undefined : spec.bodySchema,
      querySchema:
        spec.querySchema instanceof ZodNever ? undefined : spec.querySchema,
      responseSchema: spec.responseSchema,
      summary: spec.summary,
      operationId: spec.operationId,
      tags: spec.tags,
      exampleRequest: spec.exampleRequest,
    });
  });

  registerOpenApiRouter(basePath, routeSpecs, tagMeta);
  return router;
}

export const statusCodeReturn = z.strictObject({ status: z.number() });

export async function validateIsSuperUserRequest(req: {
  user?: UserInterface;
  organization: OrganizationInterface;
}) {
  if (!IS_MULTI_ORG) {
    throw new Error("This endpoint requires multi-org mode.");
  }

  if (req.organization) {
    if (!orgHasPremiumFeature(req.organization, "multi-org")) {
      throw new Error("This endpoint requires an Enterprise plan.");
    }
  }

  if (!req.user) {
    throw new Error(
      "This endpoint requires the use of a Personal Access Token rather than an API_KEY.",
    );
  }

  if (!req.user.superAdmin) {
    throw new Error(
      "This endpoint requires the Personal Access Token of a super admin.",
    );
  }

  return req.user;
}

/**
 * Given an already paginated list of items, return the pagination fields
 */
export function getPaginationReturnFields<T>(
  items: T[],
  total: number,
  query: { limit: number; offset: number },
): ApiPaginationFields {
  const limit = query.limit;
  const offset = query.offset;
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;

  return {
    limit,
    offset,
    count: items.length,
    total: total,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
  };
}

const PAGINATION_LIMIT_DEFAULT = 10;
const PAGINATION_OFFSET_DEFAULT = 0;
const PAGINATION_LIMIT_MIN = 1;
const PAGINATION_LIMIT_MAX = 100;

export type PaginationQuery = {
  limit?: number | undefined;
  offset?: number | undefined;
};

export type PaginationParams = {
  limit: number;
  offset: number;
};

/**
 * Validates limit and offset params from a query. Use before DB-level pagination
 */
export function validatePagination(
  query: PaginationQuery,
  defaults: { limit?: number; offset?: number } = {},
): PaginationParams {
  const limit = query.limit ?? defaults.limit ?? PAGINATION_LIMIT_DEFAULT;
  const offset = query.offset ?? defaults.offset ?? PAGINATION_OFFSET_DEFAULT;
  if (
    Number.isNaN(limit) ||
    limit < PAGINATION_LIMIT_MIN ||
    limit > PAGINATION_LIMIT_MAX
  ) {
    throw new Error("Pagination limit must be between 1 and 100");
  }
  if (Number.isNaN(offset) || offset < 0) {
    throw new Error("Invalid pagination offset");
  }
  return { limit, offset };
}

/**
 * Given an unpaginated list of items and a query object, return the paginated list of items and the pagination fields
 */
export function applyPagination<T>(
  items: T[],
  query: PaginationQuery,
): {
  filtered: T[];
  returnFields: ApiPaginationFields;
} {
  const { limit, offset } = validatePagination(query);

  const filtered = items.slice(offset, limit + offset);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < items.length;

  return {
    filtered,
    returnFields: {
      limit,
      offset,
      count: filtered.length,
      total: items.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    },
  };
}

export function applyFilter<T>(
  queryValue: T,
  actualValue: T | T[],
  arrayAsFilter: boolean = false,
): boolean {
  // If we're not filtering on anything, return true immediately
  if (queryValue === null || queryValue === undefined) return true;

  // If we are filtering, but the actual value is missing, return false
  if (actualValue === null || actualValue === undefined) return false;

  // If we're checking if the filter value is part of an array
  if (Array.isArray(actualValue)) {
    // Sometimes, arrays are used as a filter and when it's empty that means include everything
    if (arrayAsFilter && actualValue.length === 0) return true;
    return actualValue.includes(queryValue);
  }

  // Otherwise, check if the values are equal
  return queryValue === actualValue;
}
