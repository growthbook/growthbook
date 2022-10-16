import { Request, RequestHandler, Response } from "express";
import z, { Schema } from "zod";
import { ApiRequestLocals } from "../../types/api";

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
    req: ApiRequest<ResponseType, ParamsSchema, BodySchema, QuerySchema>,
    res: Response<{ status: number } & ResponseType>
  ) => Promise<void>;
}) {
  const wrappedHandler: RequestHandler<
    z.infer<ParamsSchema>,
    { status: number } & ResponseType,
    z.infer<BodySchema>,
    z.infer<QuerySchema>
  > = async (req, res, next) => {
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

      await handler(
        req as ApiRequest<ResponseType, ParamsSchema, BodySchema, QuerySchema>,
        res
      );
    } catch (e) {
      next(e);
    }
  };
  return wrappedHandler;
}
