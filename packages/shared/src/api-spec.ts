import { z } from "zod";
import type { ConfirmLabel } from "./validators/confirmations";

export const apiHttpVerbs = ["get", "post", "put", "delete", "patch"] as const;
export type HttpVerb = (typeof apiHttpVerbs)[number];

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
  exampleRequest?: ExampleRequest<
    z.infer<ParamsSchema>,
    z.infer<BodySchema>,
    z.infer<QuerySchema>,
    z.infer<ResponseSchema>
  >;
  excludeFromSpec?: boolean;
  /** API version prefix for the route path (default: "v1"). */
  version?: "v1" | "v2";
  /** Labels a person may have to confirm before this request runs. */
  confirmation?: readonly ConfirmLabel[];
  /** The handler holds the request itself, once it knows what changes. */
  confirmationInHandler?: boolean;
};
