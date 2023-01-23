import path from "path";
import fs from "fs";
import { Request, RequestHandler } from "express";
import z, { Schema } from "zod";
import {
  ApiErrorResponse,
  ApiPaginationFields,
  ApiRequestLocals,
} from "../../types/api";

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

function validate(schema: Schema, value: unknown): string[] {
  const result = schema.safeParse(value);
  if (!result.success) {
    return result.error.issues.map((i) => {
      return "[" + i.path.join(".") + "] " + i.message;
    });
  }
  return [];
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
      req: ApiRequest<ResponseType, ParamsSchema, BodySchema, QuerySchema>
    ) => Promise<ResponseType>
  ) => {
    const wrappedHandler: RequestHandler<
      z.infer<ParamsSchema>,
      ApiErrorResponse | ResponseType,
      z.infer<BodySchema>,
      z.infer<QuerySchema>
    > = async (req, res, next) => {
      try {
        const errors: string[] = [];
        if (paramsSchema) {
          const paramErrors = validate(paramsSchema, req.params);
          if (paramErrors.length > 0) {
            errors.push(`Request params: ` + paramErrors.join(", "));
          }
        }
        if (querySchema) {
          const queryError = validate(querySchema, req.query);
          if (queryError.length > 0) {
            errors.push(`Querystring: ` + queryError.join(", "));
          }
        }
        if (bodySchema) {
          const bodyErrors = validate(bodySchema, req.body);
          if (bodyErrors.length > 0) {
            errors.push(`Request body: ` + bodyErrors.join(", "));
          }
        }
        if (errors.length > 0) {
          return res.status(400).json({
            message: errors.join("\n"),
          });
        }

        try {
          const result = await handler(
            req as ApiRequest<
              ApiErrorResponse | ResponseType,
              ParamsSchema,
              BodySchema,
              QuerySchema
            >
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
  query: { limit?: string | undefined; offset?: string | undefined }
): {
  filtered: T[];
  returnFields: ApiPaginationFields;
} {
  const limit = parseInt(query.limit || "10");
  const offset = parseInt(query.offset || "0");
  if (isNaN(limit) || limit < 1 || limit > 100) {
    throw new Error("Pagination limit must be between 1 and 100");
  }
  if (isNaN(offset) || offset < 0 || offset >= items.length) {
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
