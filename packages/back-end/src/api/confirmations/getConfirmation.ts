import { setTimeout as delay } from "timers/promises";
import { getConfirmationValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { NotFoundError } from "back-end/src/util/errors";
import { toApiConfirmation } from "back-end/src/services/confirmations";

const MAX_WAIT_SECONDS = 30;

// Readable by the requesting key, or any token of the same person. `wait`
// long-polls: the request stays open until the status changes or time runs out.
export const getConfirmation = createApiRequestHandler(
  getConfirmationValidator,
)(async (req) => {
  const deadline =
    Date.now() + Math.min(req.query.wait ?? 0, MAX_WAIT_SECONDS) * 1000;
  for (;;) {
    const c = await req.context.models.confirmations.getById(req.params.id);
    if (
      !c ||
      (c.apiKeyId !== req.context.apiKey &&
        (!c.userId || c.userId !== req.context.userId))
    ) {
      throw new NotFoundError("Could not find that confirmation");
    }
    const confirmation = toApiConfirmation(c);
    const open =
      confirmation.status === "pending" || confirmation.status === "running";
    if (!open || Date.now() >= deadline) return { confirmation };
    await delay(1000);
    // The client hung up, so nothing will read the answer.
    if (req.res?.closed) return { confirmation };
  }
});
