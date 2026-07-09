import { v4 as uuidv4 } from "uuid";
import { tool as aiTool } from "ai";
import { z } from "zod";
import { uploadFile } from "back-end/src/services/files";
import { optimizeAIImage } from "back-end/src/services/imageOptimization";
import { getAISettingsForOrg } from "back-end/src/services/organizations";
import { generateImages } from "back-end/src/services/imageGeneration";
import { updateTokenUsage } from "back-end/src/models/AITokenUsageModel";
import { logger } from "back-end/src/util/logger";
import type { ApiReqContext } from "back-end/types/api";

// Token-equivalent cost per generated image. Keep in sync with the same
// constant in postAIImageGen.ts — both paths bill the same way.
const IMAGE_GEN_TOKEN_COST_PER_IMAGE = 1290;

export interface GenerateImageToolContext {
  context: ApiReqContext;
  // Counter shared across every generateImage call in a single chat
  // turn so the AI can't burn through credits in a loop. The toolset
  // factory creates one of these per request.
  turnCounter: { count: number; max: number };
}

const inputSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe(
      "Vivid 1-2 sentence description of the image to generate. Include style cues (photographic, illustration, minimalist) and any brand-relevant context.",
    ),
  aspectRatio: z
    .enum(["1:1", "16:9", "9:16", "4:3", "3:4"])
    .describe(
      "Aspect ratio of the output. Pick the closest match to where the image will appear. Hero/banner = 16:9, portrait/social = 9:16, square avatars = 1:1.",
    ),
});

export function generateImageTool(toolCtx: GenerateImageToolContext) {
  return aiTool({
    description:
      "Generate ONE single, standalone AI image and return its hosted URL. Call this when the user asks to replace, regenerate, set, or insert an image — for example 'replace this hero with a sunset', 'use a picture of a dog here', or 'make the background a forest scene'. The returned URL can be placed directly into a mutation's value (as a src= for <img>, a background-image: url(...) for style, or inside HTML markup for insertion). CRITICAL: each call produces exactly one cohesive image — NEVER a grid, collage, contact sheet, side-by-side comparison, or multiple tiled variants in one image. If the user wants several alternatives to choose from, call this tool multiple times with distinct prompts (one call per option) and collect the URLs into a mutation's `options` array — do not ask a single call for 'a few versions'.",
    inputSchema,
    execute: async ({ prompt, aspectRatio }) => {
      if (toolCtx.turnCounter.count >= toolCtx.turnCounter.max) {
        // Surfaced back to the model as the tool result; it will see this
        // and stop trying. Easier than throwing — exceptions inside a
        // tool can abort the whole turn depending on the SDK version.
        return {
          ok: false,
          error: `Image-generation budget exhausted for this turn (max ${toolCtx.turnCounter.max} images). Wrap up with the images you've already generated.`,
        } as const;
      }

      const { context } = toolCtx;
      const org = context.org;
      const { visualEditorImageModel, visualEditorAIContext } =
        getAISettingsForOrg(context, true);

      // Defensive single-image constraint. Even with the tool
      // description telling the model to make one image per call, an
      // ambiguous prompt ("a few options for the hero") can make the
      // image model render a collage/grid of variants in one frame.
      // This suffix steers it back to a single standalone composition.
      const SINGLE_IMAGE_SUFFIX =
        "Produce a single standalone image — not a grid, collage, contact sheet, or multiple tiled variations.";
      const effectivePrompt = visualEditorAIContext
        ? `${visualEditorAIContext}\n\n${prompt}\n\n${SINGLE_IMAGE_SUFFIX}`
        : `${prompt}\n\n${SINGLE_IMAGE_SUFFIX}`;

      try {
        const generated = await generateImages({
          context,
          model: visualEditorImageModel,
          prompt: effectivePrompt,
          count: 1,
          aspectRatio,
        });

        if (generated.length === 0) {
          return {
            ok: false,
            error: "Image generation returned no images.",
          } as const;
        }

        // Bill before upload — provider already charged us; upload failure
        // is a back-end problem, not the user's.
        try {
          await updateTokenUsage({
            organization: org,
            numTokensUsed: IMAGE_GEN_TOKEN_COST_PER_IMAGE,
          });
        } catch (err) {
          logger.warn(
            { err, orgId: org.id },
            "[ai-tool/generate-image] failed to record token usage",
          );
        }

        const img = generated[0];
        const optimized = await optimizeAIImage(img);
        const filePath = `gen/${org.id}/visual-editor/img_${uuidv4()}.${optimized.ext}`;
        const url = await uploadFile(
          filePath,
          optimized.contentType,
          optimized.buffer,
          "visual-editor-assets",
        );

        toolCtx.turnCounter.count += 1;
        return {
          ok: true,
          url,
          width: optimized.width,
          height: optimized.height,
          aspectRatio,
        } as const;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          { err: e, orgId: org.id },
          "[ai-tool/generate-image] gen failed",
        );
        return { ok: false, error: msg } as const;
      }
    },
  });
}
