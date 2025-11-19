import { Router } from "express";
import { getProperty } from "shared/util";
import { z } from "zod";
import { ApiReqContext } from "back-end/types/api";
import {
  ApiRequest,
  ApiRequestValidator,
  createApiRequestHandler,
} from "../util/handler";
import {
  getDashboardsForExperimentValidator,
  getDashboardValidator,
  updateDashboardValidator,
  postDashboardValidator,
  deleteDashboardValidator,
  listDashboardsValidator,
} from "../validators/openapi";

type CrudAction = "get" | "create" | "list" | "delete" | "update";
type HttpVerb = "get" | "post" | "put" | "delete" | "patch";
type CustomHandler = {
  pathFragment: string;
  handlerFnName: string;
  verb: HttpVerb;
  validator: ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
};
type ApiModelConfig = {
  pathBase: string;
  modelName: keyof ApiReqContext["models"];
  crudActions: Array<{
    action: CrudAction;
    validator: ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
    resultKey: string;
  }>;
  customHandlers: CustomHandler[];
};
export const apiModels: ApiModelConfig[] = [
  {
    pathBase: "/dashboards",
    modelName: "dashboards",
    crudActions: [
      {
        action: "get",
        validator: getDashboardValidator,
        resultKey: "dashboard",
      },
      {
        action: "update",
        validator: updateDashboardValidator,
        resultKey: "dashboard",
      },
      {
        action: "create",
        validator: postDashboardValidator,
        resultKey: "dashboard",
      },
      {
        action: "list",
        validator: listDashboardsValidator,
        resultKey: "dashboards",
      },
      {
        action: "delete",
        validator: deleteDashboardValidator,
        resultKey: "dashboard",
      },
    ],
    customHandlers: [
      {
        pathFragment: "/by-experiment/:experimentId",
        handlerFnName: "apiFindByExperiment",
        verb: "get",
        validator: getDashboardsForExperimentValidator,
      },
    ],
  },
];

const crudDefaults: Record<
  CrudAction,
  { verb: HttpVerb; pathFragment: string }
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

export function defineRouterForApiModel(config: ApiModelConfig) {
  const r = Router();
  config.crudActions.forEach(({ action, validator, resultKey }) => {
    const { verb, pathFragment } = crudDefaults[action];
    const handler = createApiRequestHandler(validator)(async (req) => {
      const result =
        await req.context.models[config.modelName][`handleApi${action}`](req);
      return { [resultKey]: result };
    });
    r[verb](pathFragment, handler);
  });
  config.customHandlers.forEach(
    ({ pathFragment, handlerFnName, verb, validator }) => {
      const handler = createApiRequestHandler(validator)(async (req) => {
        const model = req.context.models[config.modelName];
        const fn = getProperty(model, handlerFnName);
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
