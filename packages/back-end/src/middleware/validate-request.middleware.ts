import { RequestHandler } from "express";
import { Schema, ZodIssue } from "zod";
import { ParamsDictionary } from "express-serve-static-core";

type ValidationParams<BodySchema extends Schema, QuerySchema extends Schema> = {
  body?: BodySchema;
  query?: QuerySchema;
};

const formatZodIssue = ({ path, message }: ZodIssue): string =>
  `${path} : ${message}`;

export const validateRequestMiddleware = <
  ResponseType,
  BodySchema extends Schema,
  QuerySchema extends Schema
>({
  query: querySchema,
  body: bodySchema,
}: ValidationParams<BodySchema, QuerySchema>): RequestHandler<
  ParamsDictionary,
  ResponseType | { error?: string }
> => (req, res, next) => {
  if (querySchema) {
    const result = querySchema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues.map(formatZodIssue).join(", "),
      });
    }
  }

  if (bodySchema) {
    const result = bodySchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues.map(formatZodIssue).join(", "),
      });
    }
  }

  return next();
};
