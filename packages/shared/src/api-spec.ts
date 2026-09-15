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
};
