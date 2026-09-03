import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { disconnectFigma } from "back-end/src/services/figma";
import { requireUserAuth } from "./requireUserAuth";

// Drops the current user's stored Figma tokens. Idempotent — disconnecting
// when not connected is a no-op.
const validation = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.object({ connected: z.boolean() }),
  method: "post" as const,
  path: "/visual-editor/figma/disconnect",
  operationId: "postVisualEditorFigmaDisconnect",
  // Internal endpoint used only by the Visual Editor extension — keep it
  // out of the public OpenAPI spec.
  excludeFromSpec: true,
};

export const postFigmaDisconnect = createApiRequestHandler(validation)(async (
  req,
) => {
  const context = req.context;
  requireUserAuth(context);
  await disconnectFigma(context);
  return { connected: false };
});
