import { OpenApiRoute } from "back-end/src/util/handler";
import { postFlagImport } from "./postFlagImport";
import { getFlagImport } from "./getFlagImport";
import { postFlagImportClaim } from "./postFlagImportClaim";
import { getFlagImportDetails } from "./getFlagImportDetails";
import { postFlagImportImport } from "./postFlagImportImport";

export const flagImportsRoutes: OpenApiRoute[] = [
  postFlagImport,
  getFlagImport,
  postFlagImportClaim,
  getFlagImportDetails,
  postFlagImportImport,
];
