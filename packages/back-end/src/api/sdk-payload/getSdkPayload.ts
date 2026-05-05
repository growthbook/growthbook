import { z } from "zod";
import { RequestHandler } from "express";
import { FeatureDefinitionSDKPayload } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getPayloadParamsFromApiKey,
  getFeatureDefinitionsWithCache,
} from "back-end/src/controllers/features";

// Respond to CORS preflight requests with a 200 before falling through
// to the GET handler.
const handleSdkPayloadPreflight: RequestHandler = (req, res, next) => {
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
};

export const getSdkPayload = createApiRequestHandler({
  paramsSchema: z.object({ key: z.string() }),
  // TODO: fix this
  responseSchema: z.any(),
  summary: "Get a SDK payload",
  method: "get" as const,
  path: "/sdk-payload/:key",
  operationId: "getSdkPayload",
  middleware: [handleSdkPayloadPreflight],
})(async (req): Promise<FeatureDefinitionSDKPayload & { status: number }> => {
  const { key } = req.params;

  if (!key) {
    throw new Error("Missing API key in request");
  }

  const params = await getPayloadParamsFromApiKey(key, req);

  const defs = await getFeatureDefinitionsWithCache({
    context: req.context,
    params,
  });

  return {
    status: 200,
    ...defs,
  };
});
