import { z } from "zod";
import {
  apiCustomFieldInterface,
  apiCreateCustomFieldBody,
  apiUpdateCustomFieldBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const apiDeleteCustomFieldValidator = {
  paramsSchema: z.object({ id: z.string() }).strict(),
  bodySchema: z.never(),
  querySchema: z.strictObject({ index: z.string().optional() }),
};

export const listCustomFieldsEndpoint = {
  pathFragment: "",
  verb: "get" as const,
  operationId: "listCustomFields",
  validator: {
    bodySchema: z.never(),
    querySchema: z.strictObject({ projectId: z.string().optional() }),
    paramsSchema: z.never(),
  },
  zodReturnObject: z.array(apiCustomFieldInterface),
  summary: "Get all custom fields",
};

export const customFieldApiSpec = {
  modelSingular: "customField",
  modelPlural: "customFields",
  pathBase: "/custom-fields",
  apiInterface: apiCustomFieldInterface,
  schemas: {
    createBody: apiCreateCustomFieldBody,
    updateBody: apiUpdateCustomFieldBody,
  },
  includeDefaultCrud: false,
  crudActions: ["create", "delete", "get", "update"],
  crudValidatorOverrides: {
    delete: apiDeleteCustomFieldValidator,
  },
  customEndpoints: [listCustomFieldsEndpoint],
} satisfies OpenApiModelSpec;
export default customFieldApiSpec;
