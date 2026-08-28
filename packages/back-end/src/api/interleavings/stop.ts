import { stopInterleavingValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { stopInterleaving as stopInterleavingService } from "back-end/src/enterprise/services/interleavings";
import { toApiInterleaving } from "back-end/src/enterprise/models/InterleavingModel";
import { loadInterleavingForRead } from "./_shared";

export const stopInterleaving = createApiRequestHandler(
  stopInterleavingValidator,
)(async (req) => {
  const { interleaving } = await loadInterleavingForRead(
    req.context,
    req.params.id,
  );

  if (
    !req.context.permissions.canUpdateInterleaving(interleaving, interleaving)
  ) {
    req.context.permissions.throwPermissionError();
  }

  const updated = await stopInterleavingService(req.context, interleaving);
  return {
    interleaving: toApiInterleaving(updated),
  };
});
