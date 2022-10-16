import { Request, RequestHandler } from "express";
import path from "path";
import fs from "fs";
import z, { Schema } from "zod";
import { ApiErrorResponse, ApiRequestLocals } from "../../types/api";

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

export function createApiRequestHandler<
  ResponseType = never,
  ParamsSchema extends Schema = Schema<never>,
  BodySchema extends Schema = Schema<never>,
  QuerySchema extends Schema = Schema<never>
>({
  paramsSchema,
  bodySchema,
  querySchema,
  handler,
}: {
  bodySchema?: BodySchema;
  querySchema?: QuerySchema;
  paramsSchema?: ParamsSchema;
  handler: (
    req: ApiRequest<ResponseType, ParamsSchema, BodySchema, QuerySchema>
  ) => Promise<ResponseType>;
}) {
  const wrappedHandler: RequestHandler<
    z.infer<ParamsSchema>,
    ApiErrorResponse | ResponseType,
    z.infer<BodySchema>,
    z.infer<QuerySchema>
  > = async (req, res, next) => {
    try {
      try {
        if (bodySchema) {
          bodySchema.parse(req.body);
        }
        if (querySchema) {
          querySchema.parse(req.query);
        }
        if (paramsSchema) {
          paramsSchema.parse(req.params);
        }
      } catch (e) {
        // TODO: special handling for ZodError objects?
        return res.status(400).json({
          message: e.message,
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
