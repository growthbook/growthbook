import { Request, Response } from "express";
import { z } from "zod";
import { ApiRequestLocals } from "back-end/types/api";
import { getRemoteSavedGroupUpload } from "back-end/src/services/remoteSavedGroups";
import { getSignedImageUrl } from "back-end/src/services/files";

const SIGNED_URL_MINUTES = 15;

const paramsValidator = z
  .object({
    id: z.string(),
    version: z.coerce.number().int().positive(),
  })
  .strict();

/**
 * GET /v1/saved-groups/:id/uploads/:version/file
 *
 * An upload's CSV, as uploaded, for loaders. Redirects to a signed storage
 * URL. Loaders know which version they loaded from `latestUpload`, so there's
 * no ETag: a cached redirect would point at an expired signature.
 */
export async function getSavedGroupUploadFile(req: Request, res: Response) {
  // Registered after the API key middleware, which sets the context.
  const { context } = req as Request & ApiRequestLocals;
  try {
    const params = paramsValidator.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json({ message: "Invalid id or version" });
    }
    const { id, version } = params.data;
    const upload = await getRemoteSavedGroupUpload(context, id, version);

    res.setHeader("Cache-Control", "no-store");
    return res.redirect(
      302,
      await getSignedImageUrl(upload.fileKey, SIGNED_URL_MINUTES),
    );
  } catch (e) {
    const status = (e as { status?: number }).status ?? 400;
    return res.status(status).json({ message: (e as Error).message });
  }
}
