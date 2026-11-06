import { getAgentSignupStatusValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { sandboxStatusFor } from "back-end/src/services/agentSignup";

// The organization is loaded from the key on every request, so this reflects
// a link the moment it happens.
export const getAgentSignupStatus = createApiRequestHandler(
  getAgentSignupStatusValidator,
)(async (req) => {
  return { sandbox: sandboxStatusFor(req.context.org) };
});
