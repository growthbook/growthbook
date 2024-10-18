import { z } from "zod";
import { Router } from "express";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { findAllSDKConnectionsAcrossAllOrgs } from "back-end/src/models/SdkConnectionModel";
import { getAllGrowthbookClickhouseDataSources } from "back-end/src/models/DataSourceModel";

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

// Refresh in-mem cache every minute
const REFRESH_INTERVAL = 60_000;
let sdkData: Record<string, SdkInfo> = {};
let dataSourcesByOrgId: Record<string, string> = {};
let lastUpdate = Date.now() - REFRESH_INTERVAL;

function sdkInfo(conn: SDKConnectionInterface): SdkInfo {
  // TODO: get datasource from SDKConnection rather than naively
  return {
    organization: conn.organization,
    client_key: conn.id,
    datasource: dataSourcesByOrgId[conn.organization] || "",
  };
}

export const getDataEnrichment = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(
  async (req): Promise<GetDataEnrichmentResponse> => {
    await validateIsSuperUserRequest(req);

    if (Date.now() - lastUpdate >= REFRESH_INTERVAL) {
      const dataSources = await getAllGrowthbookClickhouseDataSources(req);
      dataSourcesByOrgId = Object.fromEntries(
        dataSources.map((ds) => [ds.organization, ds.id])
      );
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
