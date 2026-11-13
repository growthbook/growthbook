import { postFlagImportClaimValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  assertFlagImportsEnabled,
  claimFlagImportIntoWorkspace,
} from "back-end/src/services/flagImports";

export const postFlagImportClaim = createApiRequestHandler(
  postFlagImportClaimValidator,
)(async (req) => {
  assertFlagImportsEnabled();
  return {
    flagImport: await claimFlagImportIntoWorkspace(
      req.context,
      req.params.token,
      req.body,
    ),
  };
});
