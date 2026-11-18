import { getFlagImportDetailsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  getFlagImportDetails as getDetails,
} from "back-end/src/services/flagImports";
import { requireFlagImports } from "./flag-imports.middleware";

export const getFlagImportDetails = createApiRequestHandler({
  ...getFlagImportDetailsValidator,
  middleware: [requireFlagImports],
})(async (req) => {
  assertFlagImportsEnabled();
  return { flagImport: await getDetails(req.context, req.params.token) };
});
