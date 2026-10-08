import { z } from "zod";

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
};

type EndpointOnlyKey = Exclude<
  keyof ApiEndpointSpec<unknown, unknown, unknown, unknown>,
  keyof RequestSchemas<unknown, unknown, unknown>
>;

/**
 * Forbids endpoint fields on request schemas that get embedded in a route
 * built elsewhere (a custom endpoint's `validator`, a CRUD override). That
 * route sets its own path, method, and operationId, so copies here would be
 * dead, and passing the object to the REST hooks would call the wrong URL.
 */
export type NoEndpointFields<Allowed extends EndpointOnlyKey = never> = {
  [K in Exclude<EndpointOnlyKey, Allowed>]?: never;
};
