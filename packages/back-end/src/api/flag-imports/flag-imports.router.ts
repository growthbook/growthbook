import { OpenApiRoute } from "back-end/src/util/handler";
import { postFlagImport } from "./postFlagImport";
import { getFlagImport } from "./getFlagImport";
import { postFlagImportClaim } from "./postFlagImportClaim";

export const flagImportsRoutes: OpenApiRoute[] = [
  postFlagImport,
  getFlagImport,
  postFlagImportClaim,
];
