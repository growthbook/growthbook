import { Request, RequestHandler } from "express";
import { z, ZodType, ZodNever, output } from "zod";
import { ApiPaginationFields } from "shared/validators";
import { UserInterface } from "shared/types/user";
import { OrganizationInterface } from "shared/types/organization";
import { HttpVerb } from "back-end/src/api/apiModelHandlers";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiErrorResponse, ApiRequestLocals } from "back-end/types/api";
import { ConflictError } from "./errors";
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

export type RequestSchemas<ParamsSchema, BodySchema, QuerySchema> = {
  bodySchema?: BodySchema;
  querySchema?: QuerySchema;
  paramsSchema?: ParamsSchema;
};

export type ApiEndpointSpec<
  ParamsSchema,
  BodySchema,
  QuerySchema,
  ResponseSchema,
> = RequestSchemas<ParamsSchema, BodySchema, QuerySchema> & {
  responseSchema: ResponseSchema;
  method: HttpVerb;
  path: string;
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  middleware?: RequestHandler[];
  exampleRequest?: ExampleRequest<
    z.infer<ParamsSchema>,
    z.infer<BodySchema>,
    z.infer<QuerySchema>,
    z.infer<ResponseSchema>
  >;
  excludeFromSpec?: boolean;
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

export type OpenApiRoute<
  ParamsSchema extends ZodType = ZodType<unknown>,
  BodySchema extends ZodType = ZodType<unknown>,
  QuerySchema extends ZodType = ZodType<unknown>,
  ResponseSchema extends ZodType = ZodType<unknown>,
> = {
  method: HttpVerb;
  path: string;
  operationId: string;
  handler: WrappedRequestHandler<
    ParamsSchema,
    BodySchema,
    QuerySchema,
    ResponseSchema
  >;
  middleware?: RequestHandler[];
  summary?: string;
  description?: string;
  tags?: string[];
  schemas: {
    params?: ParamsSchema;
    body?: BodySchema;
    query?: QuerySchema;
    response?: ResponseSchema;
  };
  exampleRequest?: ExampleRequest<
    z.infer<ParamsSchema>,
    z.infer<BodySchema>,
    z.infer<QuerySchema>,
    z.infer<ResponseSchema>
  >;
  excludeFromSpec?: boolean;
};

export function createApiRequestHandler<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
>(
  data: ApiEndpointSpec<ParamsSchema, BodySchema, QuerySchema, ResponseSchema>,
) {
  const {
    paramsSchema,
    bodySchema,
    querySchema,
    responseSchema,
    summary,
    description,
    exampleRequest,
    tags,
    operationId,
    method,
    path,
    middleware,
    excludeFromSpec,
  } = data;

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
          const body: ApiErrorResponse = { message: e.message };
          // Surface the structured conflicts so clients can react to them.
          if (e instanceof ConflictError && e.conflicts) {
            body.conflicts = e.conflicts;
          }
          return res.status(e.status || 400).json(body);
        }
      } catch (e) {
        next(e);
      }
    };

    const route: OpenApiRoute<
      ParamsSchema,
      BodySchema,
      QuerySchema,
      ResponseSchema
    > = {
      method,
      path,
      operationId,
      summary,
      description,
      tags,
      exampleRequest,
      middleware,
      schemas: {
        params: paramsSchema,
        body: bodySchema,
        query: querySchema,
        response: responseSchema,
      },
      handler: wrappedHandler,
      excludeFromSpec,
    };

    return route;
  };
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
