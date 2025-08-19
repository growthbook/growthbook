import { RequestHandler } from "express";
import { Schema } from "zod";
import { ParamsDictionary } from "express-serve-static-core";
import { errorStringFromZodResult } from "back-end/src/util/validation";

type ValidationParams<
  ParamsSchema extends Schema,
  BodySchema extends Schema,
  QuerySchema extends Schema,
> = {
  body?: BodySchema;
  query?: QuerySchema;
  params?: ParamsSchema;
};

type ValidationError = { status: 400; message?: string; error?: string };

export const validateRequestMiddleware =
  <
    ParamsSchema extends Schema,
    ResponseType,
    BodySchema extends Schema,
    QuerySchema extends Schema,
  >({
    query: querySchema,
    body: bodySchema,
    params: paramsSchema,
  }: ValidationParams<ParamsSchema, BodySchema, QuerySchema>): RequestHandler<
    ParamsDictionary,
    ResponseType | ValidationError
  > =>
  (req, res, next) => {
    if (paramsSchema) {
      const result = paramsSchema.safeParse(req.params);
      if (!result.success) {
        return res.status(400).json({
          status: 400,
          error: errorStringFromZodResult(result),
          message: errorStringFromZodResult(result),
        } as ValidationError);
      }
    }

    if (querySchema) {
      const result = querySchema.safeParse(req.query);
      if (!result.success) {
        return res.status(400).json({
          status: 400,
          error: errorStringFromZodResult(result),
          message: errorStringFromZodResult(result),
        } as ValidationError);
      }
    }

    if (bodySchema) {
      const result = bodySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          status: 400,
          error: errorStringFromZodResult(result),
          message: errorStringFromZodResult(result),
        } as ValidationError);
      }
    }

    return next();
  };
