import { z } from "zod";
import { Router } from "express";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";

interface SdkInfo {
  organization: string;
  client_key: string;
  datasource: string;
}

interface GetDataEnrichmentResponse {
  sdkData: {
    [key: string]: SdkInfo;
  };
}

function sdkInfo(conn: SDKConnectionInterface): SdkInfo {
  return {
    organization: conn.organization,
    client_key: conn.id,
    // TODO: pull datasource
    datasource: "",
  };
}

// Refresh in-mem cache every minute
const REFRESH_INTERVAL = 60_000;
let sdkData: Record<string, SdkInfo> = {};
let lastUpdate = Date.now() - REFRESH_INTERVAL;

export const getDataEnrichment = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(
  async (req): Promise<GetDataEnrichmentResponse> => {
    await validateIsSuperUserRequest(req);

    if (Date.now() - lastUpdate >= REFRESH_INTERVAL) {
      const sdkConnections = await findAllSDKConnectionsAcrossAllOrgs();
      sdkData = Object.fromEntries(
        sdkConnections.map((conn) => [conn.id, sdkInfo(conn)])
      );
      lastUpdate = Date.now();
    }

    return { sdkData };
  }
);

const router = Router();

// add permission middleware here?

// Project Endpoints
// Mounted at /api/v1/ingestion
router.get("/data-enrichment", getDataEnrichment);

export default router;
