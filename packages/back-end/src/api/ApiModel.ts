import { Router, RequestHandler } from "express";
import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { ModelClass, ModelName } from "back-end/src/services/context";
import { ApiRequestValidator, createApiRequestHandler } from "../util/handler";

export const apiBaseSchema = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
  })
  .strict();
export type ApiBaseSchema = typeof apiBaseSchema;

type ApiCreateZodObject<T extends ApiBaseSchema> = z.ZodType<
  CreateProps<z.infer<T>>
>;

type ApiUpdateZodObject<T extends ApiBaseSchema> = z.ZodType<
  UpdateProps<z.infer<T>>
>;

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
type CrudValidatorShapes<T extends ApiBaseSchema> = {
  create: ApiRequestValidator<z.ZodNever, ApiCreateZodObject<T>, z.ZodNever>;
  delete: ApiRequestValidator<z.Schema<{ id: string }>, z.ZodNever, z.ZodNever>;
  get: ApiRequestValidator<z.Schema<{ id: string }>, z.ZodNever, z.ZodNever>;
  list: ApiRequestValidator<z.ZodNever, z.ZodNever, z.ZodNever>;
  update: ApiRequestValidator<
    z.Schema<{ id: string }>,
    ApiUpdateZodObject<T>,
    z.ZodNever
  >;
};
export type ApiModelConfig<T extends ApiBaseSchema = ApiBaseSchema> = {
  modelKey: ModelName;
  modelSingular: string;
  modelPlural: string;
  apiInterface: T;
  schemas: {
    createBody: ApiCreateZodObject<T>;
    updateBody: ApiUpdateZodObject<T>;
  };
  includeDefaultCrud?: boolean;
  crudActions?: CrudAction[];
  crudValidatorOverrides?: Partial<CrudValidatorShapes<T>>;
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

export function getCrudValidator<T extends ApiBaseSchema, A extends CrudAction>(
  action: A,
  config: ApiModelConfig,
): CrudValidatorShapes<T>[A] {
  return (
    config.crudValidatorOverrides?.[action] ??
    getDefaultValidator(
      action,
      config.schemas.createBody,
      config.schemas.updateBody,
    )
  );
}

function getDefaultValidator<
  A extends CrudAction,
  T extends ApiBaseSchema = ApiBaseSchema,
>(
  action: A,
  createBodySchema: ApiCreateZodObject<T>,
  updateBodySchema: ApiUpdateZodObject<T>,
): CrudValidatorShapes<T>[A] {
  return {
    create: {
      bodySchema: createBodySchema,
      querySchema: z.never(),
      paramsSchema: z.never(),
    },
    delete: {
      bodySchema: z.never(),
      querySchema: z.never(),
      paramsSchema: z.object({ id: z.string() }).strict(),
    },
    get: {
      bodySchema: z.never(),
      querySchema: z.never(),
      paramsSchema: z.object({ id: z.string() }).strict(),
    },
    list: {
      bodySchema: z.never(),
      querySchema: z.never(), // TODO: pagination?
      paramsSchema: z.never(),
    },
    update: {
      bodySchema: updateBodySchema,
      querySchema: z.never(),
      paramsSchema: z.object({ id: z.string() }).strict(),
    },
  }[action];
}
