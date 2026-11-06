import { postAgentSignupEmailValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { emailSandboxLink } from "back-end/src/services/agentSignup";

export const postAgentSignupEmail = createApiRequestHandler(
  postAgentSignupEmailValidator,
)(async (req) => {
  return emailSandboxLink(req.context, req.body);
});
