import path from "path";
import fs from "fs";
import { Request, RequestHandler, Response } from "express";
import z, { Schema, ZodNever } from "zod";
import { ApiErrorResponse, ApiRequestLocals } from "../../types/api";
import { ApiPaginationFields } from "../../types/openapi";

type ApiRequest<
  ResponseType = never,
  ParamsSchema extends Schema = Schema<never>,
  BodySchema extends Schema = Schema<never>,
  QuerySchema extends Schema = Schema<never>
> = ApiRequestLocals &
  Request<
    z.infer<ParamsSchema>,
    { status: number } & ResponseType,
    z.infer<BodySchema>,
    z.infer<QuerySchema>
  >;

function validate<T>(
  schema: Schema<T>,
  value: unknown
):
  | {
      success: true;
      data: T;
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

export function createApiRequestHandler<
  ParamsSchema extends Schema = Schema<never>,
  BodySchema extends Schema = Schema<never>,
  QuerySchema extends Schema = Schema<never>
>({
  paramsSchema,
  bodySchema,
  querySchema,
}: {
  bodySchema?: BodySchema;
  querySchema?: QuerySchema;
  paramsSchema?: ParamsSchema;
} = {}) {
  return <ResponseType>(
    handler: (
      req: ApiRequest<ResponseType, ParamsSchema, BodySchema, QuerySchema>,
      res: Response
    ) => Promise<ResponseType>
  ) => {
    const wrappedHandler: RequestHandler<
      z.infer<ParamsSchema>,
      ApiErrorResponse | ResponseType,
      z.infer<BodySchema>,
      z.infer<QuerySchema>
    > = async (req, res, next) => {
      try {
        const allErrors: string[] = [];
        if (paramsSchema && !(paramsSchema instanceof ZodNever)) {
          const validated = validate(paramsSchema, req.params);
          if (!validated.success) {
            allErrors.push(`Request params: ` + validated.errors.join(", "));
          } else {
            req.params = validated.data;
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
              ApiErrorResponse | ResponseType,
              ParamsSchema,
              BodySchema,
              QuerySchema
            >,
            res
          );
          return res.status(200).json(result);
        } catch (e) {
          return res.status(400).json({
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

let build: { sha: string; date: string };
export function getBuild() {
  if (!build) {
    build = {
      sha: "",
      date: "",
    };
    const rootPath = path.join(__dirname, "..", "..", "..", "..", "buildinfo");
    if (fs.existsSync(path.join(rootPath, "SHA"))) {
      build.sha = fs.readFileSync(path.join(rootPath, "SHA")).toString().trim();
    }
    if (fs.existsSync(path.join(rootPath, "DATE"))) {
      build.date = fs
        .readFileSync(path.join(rootPath, "DATE"))
        .toString()
        .trim();
    }
  }

  return build;
}

export function applyPagination<T>(
  items: T[],
  query: { limit?: number | undefined; offset?: number | undefined }
): {
  filtered: T[];
  returnFields: ApiPaginationFields;
} {
  const limit = query.limit || 10;
  const offset = query.offset || 0;
  if (isNaN(limit) || limit < 1 || limit > 100) {
    throw new Error("Pagination limit must be between 1 and 100");
  }
  if (isNaN(offset) || offset < 0 || (offset > 0 && offset >= items.length)) {
    throw new Error("Invalid pagination offset");
  }

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
  arrayAsFilter: boolean = false
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
