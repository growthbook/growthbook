import { Router, RequestHandler } from "express";
import { z } from "zod";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { ModelClass, ModelName } from "back-end/src/services/context";
import { ApiRequestValidator, createApiRequestHandler } from "../util/handler";
import { UpdateZodObject } from "../models/BaseModel";

export const apiBaseSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
  })
  .strict();
export type ApiBaseSchema = typeof apiBaseSchema;
type ApiCreateRawShape<T extends z.ZodRawShape> = {
  [k in keyof Omit<
    T,
    "id" | "organization" | "dateCreated" | "dateUpdated"
  >]: T[k];
};
type ApiCreateZodObject<T> =
  T extends z.ZodObject<
    infer RawShape,
    infer UnknownKeysParam,
    infer ZodTypeAny
  >
    ? z.ZodObject<ApiCreateRawShape<RawShape>, UnknownKeysParam, ZodTypeAny>
    : never;

const crudActions = ["get", "create", "list", "delete", "update"] as const;
type CrudAction = (typeof crudActions)[number];
type HttpVerb = "get" | "post" | "put" | "delete" | "patch";
type CustomHandler = {
  pathFragment: string;
  verb: HttpVerb;
  wrappedHandler: RequestHandler;
};
const defaultHandlers = {
  get: "handleApiGet",
  create: "handleApiCreate",
  list: "handleApiList",
  delete: "handleApiDelete",
  update: "handleApiUpdate",
} as const;
export type ApiModelConfig<T extends ApiBaseSchema = ApiBaseSchema> = {
  modelKey: ModelName;
  modelSingular: string;
  modelPlural: string;
  apiInterface: T;
  schemas: {
    createBody: ApiCreateZodObject<T>;
    updateBody: UpdateZodObject<T>;
  };
  includeDefaultCrud?: boolean;
  crudActions?: CrudAction[];
  crudValidatorOverrides?: Record<
    CrudAction,
    ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>
  >;
  customHandlers?: CustomHandler[];
};
type ApiModel = {
  pathBase: string;
  modelClass: ModelClass;
};
export const apiModels = [
  {
    pathBase: "/dashboards",
    modelClass: DashboardModel,
  },
];

const crudDefaults: Record<
  CrudAction,
  { verb: HttpVerb; pathFragment: string; plural?: boolean }
> = {
  get: {
    verb: "get",
    pathFragment: "/:id",
  },
  create: {
    verb: "post",
    pathFragment: "/",
  },
  list: {
    verb: "get",
    pathFragment: "/",
    plural: true,
  },
  delete: {
    verb: "delete",
    pathFragment: "/:id",
  },
  update: {
    verb: "post",
    pathFragment: "/:id",
  },
};

export function defineRouterForApiModel(modelDef: ApiModel) {
  const r = Router();
  const modelConfig = modelDef.modelClass.getModelConfig();
  if (!modelConfig.apiConfig) return;
  const apiConfig = modelConfig.apiConfig;
  const actions = apiConfig.includeDefaultCrud
    ? crudActions
    : (apiConfig.crudActions ?? []);
  actions.forEach((action) => {
    const { verb, pathFragment, plural } = crudDefaults[action];
    const modelString = plural
      ? apiConfig.modelPlural
      : apiConfig.modelSingular;
    const validator = getCrudValidator(action, apiConfig);
    const handler = createApiRequestHandler(validator)(async (req) => {
      const modelInstance = req.context.models[apiConfig.modelKey];
      const result = await modelInstance[defaultHandlers[action]](req);
      return { [modelString]: result };
    });
    r[verb](pathFragment, handler);
  });
  if (!apiConfig.customHandlers) return r;
  apiConfig.customHandlers.forEach(({ pathFragment, wrappedHandler, verb }) => {
    r[verb](pathFragment, wrappedHandler);
  });
  return r;
}

export function getCrudValidator(action: CrudAction, config: ApiModelConfig) {
  return (
    config.crudValidatorOverrides?.[action] ??
    getDefaultValidator(
      action,
      config.schemas.createBody,
      config.schemas.updateBody,
    )
  );
}

function getDefaultValidator<T extends ApiBaseSchema = ApiBaseSchema>(
  action: CrudAction,
  createBodySchema: ApiCreateZodObject<T>,
  updateBodySchema: UpdateZodObject<T>,
): ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny> {
  switch (action) {
    case "create":
      return {
        bodySchema: createBodySchema,
        querySchema: z.never(),
        paramsSchema: z.never(),
      };
    case "delete":
      return {
        bodySchema: z.never(),
        querySchema: z.never(),
        paramsSchema: z.object({ id: z.string() }).strict(),
      };
    case "get":
      return {
        bodySchema: z.never(),
        querySchema: z.never(),
        paramsSchema: z.object({ id: z.string() }).strict(),
      };
    case "list":
      return {
        bodySchema: z.never(),
        querySchema: z.never(), // TODO: pagination?
        paramsSchema: z.never(),
      };
    case "update":
      return {
        bodySchema: updateBodySchema,
        querySchema: z.never(),
        paramsSchema: z.object({ id: z.string() }).strict(),
      };
  }
}
