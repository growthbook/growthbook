import { Response } from "express";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { validateIsSuperUserRequest } from "back-end/src/util/handler";
import { generateDataEnrichmentJson } from "back-end/src/util/ingestion-data-enrichment";

export async function getDataEnrichment(
  req: AuthRequest<null, { datasourceId: string }>,
  res: Response
) {
  validateIsSuperUserRequest(req);
  const sdkData = await generateDataEnrichmentJson();

  res.status(200).json({
    status: 200,
    sdkData,
  });
}
