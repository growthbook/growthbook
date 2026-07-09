import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { logger } from "back-end/src/util/logger";
import { exchangeFigmaCode } from "back-end/src/services/figma";
import { requireUserAuth } from "./requireUserAuth";

// The extension drives the Figma OAuth consent via
// chrome.identity.launchWebAuthFlow, captures the `code`, and POSTs it
// here. We exchange it for tokens server-side (the client_secret never
// leaves the backend) and store them encrypted, scoped to this user.
const bodySchema = z
  .object({
    code: z.string().min(1),
    redirectUri: z.string().url(),
  })
  .strict();

const validation = {
  bodySchema,
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ connected: z.boolean() }),
  method: "post" as const,
  path: "/visual-editor/figma/oauth/exchange",
  operationId: "postVisualEditorFigmaOAuthExchange",
  // Internal endpoint used only by the Visual Editor extension — keep it
  // out of the public OpenAPI spec.
  excludeFromSpec: true,
};

export const postFigmaOAuthExchange = createApiRequestHandler(validation)(
  async (req) => {
    const context = req.context;
    requireUserAuth(context);

    await exchangeFigmaCode({
      context,
      code: req.body.code,
      redirectUri: req.body.redirectUri,
    });

    logger.info(
      { orgId: req.organization.id, userId: context.userId },
      "[visual-editor-ai/figma] connected Figma account",
    );
    return { connected: true };
  },
);
