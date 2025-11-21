import { Router } from "express";
import { getProperty, capitalizeFirstChar } from "shared/util";
import { z } from "zod";
import * as Validators from "back-end/src/validators/openapi";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { ModelClass, ModelName } from "back-end/src/services/context";
import {
  ApiRequest,
  ApiRequestValidator,
  createApiRequestHandler,
} from "../util/handler";

const crudActions = ["get", "create", "list", "delete", "update"] as const;
type CrudAction = (typeof crudActions)[number];
type HttpVerb = "get" | "post" | "put" | "delete" | "patch";
type CustomHandler = {
  pathFragment: string;
  handlerFnName: string;
  verb: HttpVerb;
  validator: ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
};
export type ApiModelConfig = {
  modelKey: ModelName;
  modelSingular: string;
  modelPlural: string;
  includeDefaultCrud?: boolean;
  crudActions?: CrudAction[];
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
  const actions = modelConfig.apiConfig.includeDefaultCrud
    ? crudActions
    : (modelConfig.apiConfig.crudActions ?? []);
  actions.forEach((action) => {
    const { verb, pathFragment, plural } = crudDefaults[action];
    const modelString = plural
      ? apiConfig.modelPlural
      : apiConfig.modelSingular;
    const validator = getProperty(
      Validators,
      `${action}${capitalizeFirstChar(modelString)}Validator`,
    ) as ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
    const handler = createApiRequestHandler(validator)(async (req) => {
      const modelInstance = req.context.models[apiConfig.modelKey];
      const result = await modelInstance[`handleApi${action}`](req);
      return { [modelString]: result };
    });
    r[verb](pathFragment, handler);
  });
  if (!apiConfig.customHandlers) return r;
  apiConfig.customHandlers.forEach(
    ({ pathFragment, handlerFnName, verb, validator }) => {
      const handler = createApiRequestHandler(validator)(async (req) => {
        const modelInstance = req.context.models[apiConfig.modelKey];
        const fn = getProperty(modelInstance, handlerFnName);
        // Quick validation that the handler is a function with 1 argument
        if (typeof fn !== "function" || fn.length !== 1)
          throw new Error("Improperly configured handler " + handlerFnName);
        return await (
          fn as (
            req: ApiRequest<unknown, z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>,
          ) => Promise<unknown> | unknown
        )(req);
      });
      r[verb](pathFragment, handler);
    },
  );
  return r;
}
