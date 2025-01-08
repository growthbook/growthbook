import { z } from "zod";
import { Router } from "express";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { _dangerousGetSdkConnectionsAcrossMultipleOrgs } from "back-end/src/models/SdkConnectionModel";
import { _dangerousGetAllGrowthbookClickhouseDataSources } from "back-end/src/models/DataSourceModel";

interface SdkInfo {
  organization: string;
  client_key: string;
  datasource: string;
  environment: string;
}

interface GetDataEnrichmentResponse {
  sdkData: {
    [key: string]: SdkInfo;
  };
}

function sdkInfo(conn: SDKConnectionInterface, datasource: string): SdkInfo {
  return {
    organization: conn.organization,
    client_key: conn.key,
    environment: conn.environment,
    datasource,
  };
}

export const getDataEnrichment = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(
  async (req): Promise<GetDataEnrichmentResponse> => {
    // Must be a super-user to make cross-org mongo queries
    await validateIsSuperUserRequest(req);

    const dataSources = await _dangerousGetAllGrowthbookClickhouseDataSources();
    const dataSourcesByOrgId = Object.fromEntries(
      dataSources.map((ds) => [ds.organization, ds.id])
    );
    const sdkConnections = await _dangerousGetSdkConnectionsAcrossMultipleOrgs(
      Object.keys(dataSourcesByOrgId)
    );
    const sdkData = Object.fromEntries(
      sdkConnections.map((conn) => [
        conn.key,
        sdkInfo(conn, dataSourcesByOrgId[conn.organization]),
      ])
    );

    return { sdkData };
  }
);

const router = Router();

// Mounted at /api/v1/ingestion
router.get("/data-enrichment", getDataEnrichment);

export default router;
