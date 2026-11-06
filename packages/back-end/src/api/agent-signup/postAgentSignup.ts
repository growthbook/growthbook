import rateLimit from "express-rate-limit";
import { postAgentSignupValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  AgentSignupError,
  createAgentSandbox,
  isAgentSignupEnabled,
} from "back-end/src/services/agentSignup";

// Nobody has a key yet, so the address is the only handle. Per replica: the
// default MemoryStore isn't shared, and the open-sandbox cap is the backstop.
const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "",
  message: {
    message: "Too many sandbox signups from this address. Try again later.",
  },
});

export const postAgentSignup = createApiRequestHandler({
  ...postAgentSignupValidator,
  middleware: [signupRateLimit],
})(async (req) => {
  // Off means not here, the same as any unknown path.
  if (!isAgentSignupEnabled()) {
    throw new AgentSignupError(404, "Not found");
  }
  const { language, environment, name, run } = req.body;
  return createAgentSandbox({
    language,
    environment,
    name,
    run,
    apiHost: `${req.protocol}://${req.get("host")}`,
  });
});
