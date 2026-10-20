import {
  apiCreateUrlRedirectBody,
  apiListUrlRedirectsValidator,
  apiUpdateUrlRedirectBody,
  apiUrlRedirectValidator,
} from "shared/validators";
import { ApiUpdateZodObject, OpenApiModelSpec } from "shared/api-model";

export const urlRedirectApiSpec = {
  modelSingular: "urlRedirect",
  modelPlural: "urlRedirects",
  pathBase: "/url-redirects",
  apiInterface: apiUrlRedirectValidator,
  schemas: {
    createBody: apiCreateUrlRedirectBody,
    // UpdateProps forbids the base keys this body echoes; handleApiUpdate drops them
    updateBody: apiUpdateUrlRedirectBody as unknown as ApiUpdateZodObject<
      typeof apiUrlRedirectValidator
    >,
  },
  includeDefaultCrud: true,
  confirmation: {
    create: ["experiment.other"],
    update: ["experiment.other"],
    delete: ["experiment.other"],
  },
  crudValidatorOverrides: {
    list: apiListUrlRedirectsValidator,
  },
  crudDescriptions: {
    create:
      "Rejected if the origin or destinations overlap another running redirect, which would loop.",
  },
  navDisplayName: "URL Redirects",
  navDescription: "Redirect tests: send each variation to a different URL.",
  navAfterTag: "experiments",
} satisfies OpenApiModelSpec;
export default urlRedirectApiSpec;
