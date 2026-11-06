import { OpenApiRoute } from "back-end/src/util/handler";
import { postAgentSignup } from "./postAgentSignup";
import { getAgentSignupStatus } from "./getAgentSignupStatus";
import { postAgentSignupEmail } from "./postAgentSignupEmail";

export const agentSignupRoutes: OpenApiRoute[] = [
  postAgentSignup,
  getAgentSignupStatus,
  postAgentSignupEmail,
];
