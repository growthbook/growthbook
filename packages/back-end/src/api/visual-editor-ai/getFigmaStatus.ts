import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  figmaOAuthConfigured,
  getFigmaClientId,
  isFigmaConnected,
} from "back-end/src/services/figma";
import { requireUserAuth } from "./requireUserAuth";

// Tells the extension whether the current user has a live Figma
// connection, and hands back the public client_id it needs to launch the
// OAuth consent flow (the secret stays server-side). `configured` is false
// when the deployment hasn't set the Figma OAuth env vars at all.
const validation = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
  responseSchema: z.any(),
  method: "get" as const,
  path: "/visual-editor/figma/status",
  operationId: "getVisualEditorFigmaStatus",
};

export const getFigmaStatus = createApiRequestHandler(validation)(async (
  req,
) => {
  const context = req.context;
  requireUserAuth(context);

  const configured = figmaOAuthConfigured();
  const { connected, expiresAt } = configured
    ? await isFigmaConnected(context)
    : { connected: false, expiresAt: null };

  return {
    configured,
    connected,
    expiresAt,
    clientId: configured ? getFigmaClientId() : "",
    scope: "file_content:read",
  };
});
