import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { generateDataEnrichmentJson } from "back-end/src/util/ingestion-data-enrichment";
import { getDataEnrichmentValidator } from "back-end/src/validators/openapi";
import { GetDataEnrichmentResponse } from "back-end/types/openapi";

export const getDataEnrichment = createApiRequestHandler(
  getDataEnrichmentValidator
)(
  async (req): Promise<GetDataEnrichmentResponse> => {
    validateIsSuperUserRequest(req);
    const sdkData = await generateDataEnrichmentJson();

    return { sdkData };
  }
);
