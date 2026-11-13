import { postFlagImportClaimValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  claimFlagImportForWorkspace,
} from "back-end/src/services/flagImports";

export const postFlagImportClaim = createApiRequestHandler(
  postFlagImportClaimValidator,
)(async (req) => {
  assertFlagImportsEnabled();
  return {
    flagImport: await claimFlagImportForWorkspace(
      req.context,
      req.params.token,
    ),
  };
});
