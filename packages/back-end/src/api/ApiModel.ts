import { Router } from "express";
import { z } from "zod";
import { CreateProps, UpdateProps } from "shared/types/base-model";
import { apiBaseSchema } from "shared/validators";
import { DashboardModel } from "back-end/src/enterprise/models/DashboardModel";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";
import { ModelClass, ModelName } from "back-end/src/services/context";
import {
  ApiRequestValidator,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { MetricGroupModel } from "back-end/src/models/MetricGroupModel";
import {
  CustomApiHandler,
  CrudAction,
  crudActions,
  defaultHandlers,
  HttpVerb,
} from "./apiModelHandlers";

export const API_MODELS: ModelClass[] = [
  DashboardModel,
  CustomFieldModel,
  MetricGroupModel,
];

export type ApiBaseSchema = typeof apiBaseSchema;
type ApiCreateZodObject<T extends ApiBaseSchema> = z.ZodType<
  CreateProps<z.infer<T>>
>;
type ApiUpdateZodObject<T extends ApiBaseSchema> = z.ZodType<
  UpdateProps<z.infer<T>>
>;
type CrudValidatorShapes<T extends ApiBaseSchema> = {
  create: ApiRequestValidator<z.ZodNever, ApiCreateZodObject<T>, z.ZodNever>;
  delete: ApiRequestValidator<
    z.ZodType<{ id: string }>,
    z.ZodNever,
    z.ZodNever
  >;
  get: ApiRequestValidator<z.ZodType<{ id: string }>, z.ZodNever, z.ZodNever>;
  list: ApiRequestValidator<z.ZodNever, z.ZodNever, z.ZodNever>;
  update: ApiRequestValidator<
    z.ZodType<{ id: string }>,
    ApiUpdateZodObject<T>,
    z.ZodNever
  >;
};
export type ApiModelConfig<
  T extends ApiBaseSchema = ApiBaseSchema,
  C extends
    ApiCreateZodObject<ApiBaseSchema> = ApiCreateZodObject<ApiBaseSchema>,
  U extends
    ApiUpdateZodObject<ApiBaseSchema> = ApiUpdateZodObject<ApiBaseSchema>,
> = {
  modelKey: ModelName;
  modelSingular: string;
  modelPlural: string;
  apiInterface: T;
  schemas: {
    createBody: C;
    updateBody: U;
  };
  pathBase: string;
  includeDefaultCrud?: boolean;
  crudActions?: CrudAction[];
  crudValidatorOverrides?: Partial<CrudValidatorShapes<T>>;
  customHandlers?: CustomApiHandler[]; // Wrap config object with defineCustomApiHandler for proper type inference
};

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
    pathFragment: "",
  },
  list: {
    verb: "get",
    pathFragment: "",
    plural: true,
  },
  delete: {
    verb: "delete",
    pathFragment: "/:id",
  },
  update: {
    verb: "put",
    pathFragment: "/:id",
  },
};
type CrudActionConfig<
  T extends ApiBaseSchema,
  A extends CrudAction = CrudAction,
> = {
  action: A;
  verb: HttpVerb;
  pathFragment: string;
  validator: CrudValidatorShapes<T>[A];
  returnKey: string;
  plural: boolean | undefined;
};
export function getCrudConfig<T extends ApiBaseSchema>(
  apiConfig: ApiModelConfig,
): CrudActionConfig<T>[] {
  const actions = apiConfig.includeDefaultCrud
    ? crudActions
    : (apiConfig.crudActions ?? []);
  return actions.map((action) => {
    const { verb, pathFragment, plural } = crudDefaults[action];
    const validator = getCrudValidator(action, apiConfig);
    const returnKey =
      action === "delete"
        ? "deletedId"
        : plural
          ? apiConfig.modelPlural
          : apiConfig.modelSingular;
    return { action, verb, pathFragment, validator, returnKey, plural };
  });
}

export function defineRouterForApiConfig(apiConfig: ApiModelConfig) {
  const r = Router();
  const crudConfig = getCrudConfig(apiConfig);
  crudConfig.forEach(({ action, verb, pathFragment, validator, returnKey }) => {
    const handler = createApiRequestHandler(validator)(async (req) => {
      const modelInstance = req.context.models[apiConfig.modelKey];
      const result = await modelInstance[defaultHandlers[action]](req);
      return { [returnKey]: result };
    });
    r[verb](pathFragment, handler);
  });
  if (!apiConfig.customHandlers) return r;
  apiConfig.customHandlers.forEach(
    ({ pathFragment, validator, reqHandler, verb }) => {
      const wrappedHandler = createApiRequestHandler(validator)(reqHandler);
      r[verb](pathFragment, wrappedHandler);
    },
  );
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

export function getDefaultCrudActionSummary(
  action: CrudAction,
  modelSingular: string,
  modelPlural: string,
): string {
  switch (action) {
    case "create":
      return `Create a single ${modelSingular}`;
    case "delete":
      return `Delete a single ${modelSingular}`;
    case "get":
      return `Get a single ${modelSingular}`;
    case "list":
      return `Get all ${modelPlural}`;
    case "update":
      return `Update a single ${modelSingular}`;
  }
}

export function generateYamlForPath({
  path,
  verb,
  validator,
  returnSchema,
  operationId,
  summary = "",
  tags = [],
}: {
  path: string;
  verb: HttpVerb;
  validator: ApiRequestValidator<z.ZodTypeAny, z.ZodTypeAny, z.ZodTypeAny>;
  returnSchema: object;
  operationId: string;
  summary?: string;
  tags?: string[];
}) {
  const formattedParams: Array<object> = [];
  const { paramsSchema, bodySchema, querySchema } = validator;
  if (paramsSchema instanceof z.ZodObject) {
    const paramsJson = z.toJSONSchema(paramsSchema);
    Object.entries(paramsJson.properties ?? {}).forEach(
      ([paramName, paramInfo]) => {
        if (typeof paramInfo !== "object") return;
        formattedParams.push({
          name: paramName,
          in: "path",
          required: (paramsJson.required ?? []).includes(paramName),
          schema: paramInfo,
        });
      },
    );
  }
  if (querySchema instanceof z.ZodObject) {
    const queryJson = z.toJSONSchema(querySchema);
    Object.entries(queryJson.properties ?? {}).forEach(
      ([paramName, paramInfo]) => {
        if (typeof paramInfo !== "object") return;
        formattedParams.push({
          name: paramName,
          in: "query",
          required: (queryJson.required ?? []).includes(paramName),
          schema: paramInfo,
        });
      },
    );
  }
  let requestBody: object | undefined = undefined;
  if (bodySchema instanceof z.ZodObject) {
    const bodyJson = z.toJSONSchema(bodySchema);
    requestBody = {
      required: true,
      content: {
        "application/json": {
          schema: bodyJson,
        },
      },
    };
  }
  return {
    $skipValidatorGeneration: true,
    parameters: formattedParams,
    tags: tags,
    summary,
    operationId,
    "x-codeSamples": [
      {
        lang: "cURL",
        source: `curl -X ${verb.toLocaleUpperCase()} https://api.growthbook.io/api/v1${path} ${requestBody ? "-d '{ ... }' " : ""}-u secret_abc123DEF456`,
      },
    ],
    requestBody,
    responses: {
      "200": {
        content: {
          "application/json": {
            schema: returnSchema,
          },
        },
      },
    },
  };
}
