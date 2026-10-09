import {
  apiCreateUrlRedirectBody,
  apiListUrlRedirectsValidator,
  apiUpdateUrlRedirectBody,
  apiUrlRedirectValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const urlRedirectApiSpec = {
  modelSingular: "urlRedirect",
  modelPlural: "urlRedirects",
  pathBase: "/url-redirects",
  apiInterface: apiUrlRedirectValidator,
  schemas: {
    createBody: apiCreateUrlRedirectBody,
    updateBody: apiUpdateUrlRedirectBody,
  },
  includeDefaultCrud: true,
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
