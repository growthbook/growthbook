import { postFlagImportImportValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  importClaimedFlags,
} from "back-end/src/services/flagImports";
import { requireFlagImports } from "./flag-imports.middleware";

export const postFlagImportImport = createApiRequestHandler({
  ...postFlagImportImportValidator,
  middleware: [requireFlagImports],
})(async (req) => {
  assertFlagImportsEnabled();
  return {
    flagImport: await importClaimedFlags(
      req.context,
      req.params.token,
      req.body,
    ),
  };
});
