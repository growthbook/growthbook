import { z } from "zod";
import { FeatureDefinitionSDKPayload } from "back-end/src/services/features";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  getPayloadParamsFromApiKey,
  getFeatureDefinitionsWithCache,
} from "back-end/src/controllers/features";

export const getSdkPayload = createApiRequestHandler({
  paramsSchema: z.object({ key: z.string() }),
  // TODO: fix this
  responseSchema: z.any(),
  summary: "Get a SDK payload",
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
