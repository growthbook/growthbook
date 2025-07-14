import { z } from "zod";
import { Router } from "express";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import { _dangerousGetSdkConnectionsAcrossMultipleOrgs } from "back-end/src/models/SdkConnectionModel";
import { _dangerousGetAllGrowthbookClickhouseDataSources } from "back-end/src/models/DataSourceModel";
import { getOrganizationIdsWithTrackingDisabled } from "back-end/src/models/OrganizationModel";

interface SdkInfo {
  organization: string;
  client_key: string;
  datasource: string;
  environment: string;
  trackingDisabled: boolean;
}

interface GetDataEnrichmentResponse {
  sdkData: {
    [key: string]: SdkInfo;
  };
}

function sdkInfo(
  conn: SDKConnectionInterface,
  datasource: string,
  trackingDisabled: boolean
): SdkInfo {
  return {
    organization: conn.organization,
    client_key: conn.key,
    environment: conn.environment,
    datasource,
    trackingDisabled,
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
    const orgIds = Object.keys(dataSourcesByOrgId);
    const sdkConnections = await _dangerousGetSdkConnectionsAcrossMultipleOrgs(
      orgIds
    );

    const orgIdsWithTrackingDisabled = await getOrganizationIdsWithTrackingDisabled(
      orgIds
    );

    const sdkData = Object.fromEntries(
      sdkConnections.map((conn) => [
        conn.key,
        sdkInfo(
          conn,
          dataSourcesByOrgId[conn.organization],
          orgIdsWithTrackingDisabled.has(conn.organization)
        ),
      ])
    );

    return { sdkData };
  }
);

const router = Router();

// Mounted at /api/v1/ingestion
router.get("/data-enrichment", getDataEnrichment);

export default router;
