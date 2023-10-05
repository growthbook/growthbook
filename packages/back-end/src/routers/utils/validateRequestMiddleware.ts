import { RequestHandler } from "express";
import { Schema } from "zod";
import { ParamsDictionary } from "express-serve-static-core";
import { errorStringFromZodResult } from "../../util/validation";

type ValidationParams<
  ParamsSchema extends Schema,
  BodySchema extends Schema,
  QuerySchema extends Schema
> = {
  body?: BodySchema;
  query?: QuerySchema;
  params?: ParamsSchema;
};

export const validateRequestMiddleware = <
  ParamsSchema extends Schema,
  ResponseType,
  BodySchema extends Schema,
  QuerySchema extends Schema
>({
  query: querySchema,
  body: bodySchema,
  params: paramsSchema,
}: ValidationParams<ParamsSchema, BodySchema, QuerySchema>): RequestHandler<
  ParamsDictionary,
  ResponseType | { status: 400; message?: string; error?: string }
> => (req, res, next) => {
  if (paramsSchema) {
    const result = paramsSchema.safeParse(req.params);
    if (!result.success) {
      return res.status(400).json({
        status: 400,
        error: errorStringFromZodResult(result),
        message: errorStringFromZodResult(result),
      });
    }
  }

  if (querySchema) {
    const result = querySchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        status: 400,
        error: errorStringFromZodResult(result),
        message: errorStringFromZodResult(result),
      });
    }
  }

  if (bodySchema) {
    const result = bodySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        status: 400,
        error: errorStringFromZodResult(result),
        message: errorStringFromZodResult(result),
      });
    }
  }

  return next();
};
