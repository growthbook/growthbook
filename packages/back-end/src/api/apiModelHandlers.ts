import { z } from "zod";
import { ApiRequest, ApiRequestValidator } from "back-end/src/util/handler";

export const crudActions = [
  "get",
  "create",
  "list",
  "delete",
  "update",
] as const;
export type CrudAction = (typeof crudActions)[number];
export const apiHttpVerbs = ["get", "post", "put", "delete", "patch"] as const;
export type HttpVerb = (typeof apiHttpVerbs)[number];

export const defaultHandlers = {
  get: "handleApiGet",
  create: "handleApiCreate",
  list: "handleApiList",
  delete: "handleApiDelete",
  update: "handleApiUpdate",
} as const;

export type CustomApiHandler<
  ParamsSchema extends z.ZodType = z.ZodTypeAny,
  BodySchema extends z.ZodType = z.ZodTypeAny,
  QuerySchema extends z.ZodType = z.ZodTypeAny,
  ReturnShape extends z.ZodType = z.ZodTypeAny,
> = {
  pathFragment: string;
  verb: HttpVerb;
  operationId: string;
  validator: ApiRequestValidator<ParamsSchema, BodySchema, QuerySchema>;
  zodReturnObject: ReturnShape;
  summary: string; // For generating docs, e.g. "Get all dashboards for an experiment"
  reqHandler: (
    req: ApiRequest<
      z.infer<ReturnShape>,
      ParamsSchema,
      BodySchema,
      QuerySchema
    >,
    // You'll likely need to add an explicit type annotation for the return shape because of a type inference cycle
  ) => Promise<z.infer<ReturnShape>>;
};

export function defineCustomApiHandler<
  ParamsSchema extends z.ZodType,
  BodySchema extends z.ZodType,
  QuerySchema extends z.ZodType,
  ReturnShape extends z.ZodType,
>(
  handler: CustomApiHandler<ParamsSchema, BodySchema, QuerySchema, ReturnShape>,
): typeof handler {
  return handler;
}
