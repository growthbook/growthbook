import { z } from "zod";
import {
  apiExperimentTemplateValidator,
  apiListExperimentTemplatesValidator,
  apiCreateExperimentTemplateBody,
  apiUpdateExperimentTemplateBody,
  apiBulkImportExperimentTemplatesBody,
  apiBulkImportExperimentTemplatesResponse,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const bulkImportExperimentTemplatesEndpoint = {
  pathFragment: "/bulk-import",
  verb: "post" as const,
  operationId: "bulkImportExperimentTemplates",
  validator: {
    bodySchema: apiBulkImportExperimentTemplatesBody,
    querySchema: z.never(),
    paramsSchema: z.never(),
  },
  zodReturnObject: apiBulkImportExperimentTemplatesResponse,
  summary: "Bulk create or update experiment templates",
};

export const experimentTemplateApiSpec = {
  modelSingular: "experimentTemplate",
  modelPlural: "experimentTemplates",
  pathBase: "/experiment-templates",
  apiInterface: apiExperimentTemplateValidator,
  schemas: {
    createBody: apiCreateExperimentTemplateBody,
    updateBody: apiUpdateExperimentTemplateBody,
  },
  includeDefaultCrud: true,
  crudValidatorOverrides: {
    list: apiListExperimentTemplatesValidator,
  },
  navAfterTag: "experiments",
  customEndpoints: [bulkImportExperimentTemplatesEndpoint],
} satisfies OpenApiModelSpec;
export default experimentTemplateApiSpec;
