import { Request, RequestHandler } from "express";
import { z, ZodType, ZodNever, output } from "zod";
import { ApiPaginationFields, ApiErrorCode } from "shared/validators";
import { UserInterface } from "shared/types/user";
import { OrganizationInterface } from "shared/types/organization";
import {
  ApiEndpointSpec,
  ExampleRequest,
  HttpVerb,
  RequestSchemas,
} from "shared/api-spec";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { ApiErrorResponse, ApiRequestLocals } from "back-end/types/api";
import { ApiError, MergeConflictError, SoftWarningError } from "./errors";
import { IS_MULTI_ORG } from "./secrets";

export type { ApiEndpointSpec, ExampleRequest, HttpVerb, RequestSchemas };

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

// Back-end-only extension of ApiEndpointSpec that adds express middleware.
// The shared type is intentionally framework-agnostic.
export type BackEndApiEndpointSpec<
  ParamsSchema,
  BodySchema,
  QuerySchema,
  ResponseSchema,
> = ApiEndpointSpec<ParamsSchema, BodySchema, QuerySchema, ResponseSchema> & {
  middleware?: RequestHandler[];
  exampleRequest?: ExampleRequest<
    z.infer<ParamsSchema>,
    z.infer<BodySchema>,
    z.infer<QuerySchema>,
    z.infer<ResponseSchema>
  >;
  excludeFromSpec?: boolean;
  version?: "v1" | "v2";
  deprecated?: boolean;
  /**
   * RFC 8594 `Deprecation` header field value. Accepts either `"true"` (deprecated
   * now, no removal date) or `"@<unix-timestamp>"` (deprecated as of that date).
   */
  deprecationDate?: string;
  /** Error codes this endpoint may throw, used to generate OpenAPI error response schemas. */
  possibleErrors?: readonly ApiErrorCode[];
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

/**
 * The "raw" business-logic handler an API endpoint is defined with: it reads a
 * request-shaped object and resolves to the response body. This is the function
 * passed into the curried `createApiRequestHandler(...)(handler)` call — the one
 * the Express wrapper closes over. We expose its type so callers that drive the
 * handler without Express (see `runApiHandler` + the in-process dispatcher) get
 * the same contract.
 */
export type RawApiRequestHandler<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
> = (
  req: ApiRequest<
    z.infer<ResponseSchema>,
    ParamsSchema,
    BodySchema,
    QuerySchema
  >,
) => Promise<z.infer<ResponseSchema>>;

/**
 * The single source of truth for "validate the three inputs, run the business
 * handler, shape success/error into `{status, body}`". Both the Express wrapper
 * (`createApiRequestHandler`) and the in-process dispatcher call this, so there
 * is exactly one copy of the validation + response/error contract and the two
 * surfaces can never drift.
 *
 * Notes:
 *  - Validation writes the *parsed* (Zod-transformed/coerced/defaulted) output
 *    back onto `req`, so the handler reads the same values it would over HTTP.
 *  - The returned `body` is the in-memory object; callers are responsible for
 *    serialization (`res.json` over HTTP, `JSON.stringify` round-trip for the
 *    dispatcher's on-the-wire fidelity).
 */
export async function runApiHandler(
  req: { params: unknown; query: unknown; body: unknown },
  schemas: {
    params?: ZodType;
    body?: ZodType;
    query?: ZodType;
  },
  handler: (req: never) => Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  const allErrors: string[] = [];
  if (schemas.params && !(schemas.params instanceof ZodNever)) {
    const validated = validate(schemas.params, req.params);
    if (!validated.success) {
      allErrors.push(`Request params: ` + validated.errors.join(", "));
    } else {
      req.params = validated.data;
    }
  }
  if (schemas.query && !(schemas.query instanceof ZodNever)) {
    const validated = validate(schemas.query, req.query);
    if (!validated.success) {
      allErrors.push(`Querystring: ` + validated.errors.join(", "));
    } else {
      req.query = validated.data;
    }
  }
  if (schemas.body && !(schemas.body instanceof ZodNever)) {
    const validated = validate(schemas.body, req.body);
    if (!validated.success) {
      allErrors.push(`Request body: ` + validated.errors.join(", "));
    } else {
      req.body = validated.data;
    }
  }
  if (allErrors.length > 0) {
    return { status: 400, body: { message: allErrors.join("\n") } };
  }

  try {
    const result = await handler(req as never);
    return { status: 200, body: result };
  } catch (e) {
    const body: ApiErrorResponse = { message: e.message };
    if (e instanceof ApiError) {
      body.code = e.code;
      body.details = e.details;
      // Transitional back-compat: mirror conflicts to top level so existing
      // external clients of feature-revision publish/rebase don't break.
      // TODO: remove once clients are reading `details.conflicts` instead.
      if (e instanceof MergeConflictError) {
        body.conflicts = e.details.conflicts;
      }
    }
    // Surface soft warnings so clients can re-submit with `?ignoreWarnings=true`
    if (e instanceof SoftWarningError) {
      body.warnings = e.warnings;
      // Front-end shows a "Save anyway" dialog and doesn't need a querystring hint
      const isJwtAuth = (req as unknown as ApiRequestLocals).isJwtAuth;
      if (!isJwtAuth) {
        body.message =
          e.message +
          "\n\nEither address the warnings or append '?ignoreWarnings=true' to the URL to proceed.";
      }
    }
    return { status: e.status || 400, body };
  }
}

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
  /**
   * The unwrapped business-logic handler, exposed so in-process callers (the
   * dispatcher) can run it via `runApiHandler` without an Express `res`/`next`.
   * Same function the Express `handler` wraps — so both paths share validation
   * and response/error shaping.
   */
  rawHandler: RawApiRequestHandler<
    ParamsSchema,
    BodySchema,
    QuerySchema,
    ResponseSchema
  >;
  middleware?: RequestHandler[];
  /** API version prefix for the OpenAPI spec path (default: "v1"). */
  version?: "v1" | "v2";
  deprecated?: boolean;
  /**
   * RFC 8594 `Deprecation` header field value. Accepts either `"true"` (deprecated
   * now, no removal date) or `"@<unix-timestamp>"` (deprecated as of that date).
   */
  deprecationDate?: string;
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
  /** Error codes this endpoint may throw, used to generate OpenAPI error response schemas. */
  possibleErrors?: readonly ApiErrorCode[];
};

export function createApiRequestHandler<
  ParamsSchema extends ZodType = ZodType<never>,
  BodySchema extends ZodType = ZodType<never>,
  QuerySchema extends ZodType = ZodType<never>,
  ResponseSchema extends ZodType = ZodType<never>,
>(
  data: BackEndApiEndpointSpec<
    ParamsSchema,
    BodySchema,
    QuerySchema,
    ResponseSchema
  >,
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
    version,
    deprecated,
    deprecationDate,
    possibleErrors,
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
        const { status, body } = await runApiHandler(
          req,
          {
            params: paramsSchema,
            body: bodySchema,
            query: querySchema,
          },
          handler,
        );
        return res
          .status(status)
          .json(body as ApiErrorResponse | z.infer<ResponseSchema>);
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
      version,
      deprecated,
      deprecationDate,
      schemas: {
        params: paramsSchema,
        body: bodySchema,
        query: querySchema,
        response: responseSchema,
      },
      handler: wrappedHandler,
      rawHandler: handler,
      excludeFromSpec,
      possibleErrors,
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
