import { tool as aiTool } from "ai";
import { z } from "zod";
import { listFiles } from "back-end/src/services/files";
import { logger } from "back-end/src/util/logger";
import type { ApiReqContext } from "back-end/types/api";

// Search-by-filename for now; the bucket doesn't currently store
// descriptive metadata, so the AI's best signal is recency and the
// `query` filter is a substring match on the filename. The right
// upgrade later is storing descriptive metadata at gen/upload time so
// this can be a real semantic search.

const inputSchema = z.object({
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Optional case-insensitive substring to filter filenames. Omit to list the most recent images.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("How many images to return. Default 5."),
});

export function searchImageLibraryTool(context: ApiReqContext) {
  return aiTool({
    description:
      "List the most recent images in the user's GrowthBook image library so you can reuse one instead of generating a new one. Useful when the user says 'use an existing image' or references a previously generated image. Returns each image's URL and upload date — no visual content is available, so prefer generateImage when the user describes a specific look.",
    inputSchema,
    execute: async ({ query, limit }) => {
      const orgId = context.org.id;
      try {
        const files = await listFiles(
          `${orgId}/visual-editor/`,
          "visual-editor-assets",
          200,
        );
        const filtered = query
          ? files.filter((f) =>
              f.key.toLowerCase().includes(query.toLowerCase()),
            )
          : files;
        filtered.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
        return {
          ok: true,
          images: filtered.slice(0, limit).map((f) => ({
            url: f.url,
            uploadedAt: f.uploadedAt,
          })),
        } as const;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({ err: e, orgId }, "[ai-tool/search-image-library] failed");
        return { ok: false, error: msg } as const;
      }
    },
  });
}
