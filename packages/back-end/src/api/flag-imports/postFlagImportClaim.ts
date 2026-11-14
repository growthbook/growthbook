import { postFlagImportClaimValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  claimFlagImportForWorkspace,
} from "back-end/src/services/flagImports";
import { requireFlagImports } from "./flag-imports.middleware";

export const postFlagImportClaim = createApiRequestHandler({
  ...postFlagImportClaimValidator,
  middleware: [requireFlagImports],
})(async (req) => {
  assertFlagImportsEnabled();
  return {
    flagImport: await claimFlagImportForWorkspace(
      req.context,
      req.params.token,
    ),
  };
});
