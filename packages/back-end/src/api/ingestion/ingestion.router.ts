import { z } from "zod";
import { Router } from "express";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  createApiRequestHandler,
  validateIsSuperUserRequest,
} from "back-end/src/util/handler";
import { _dangerousGetSdkConnectionsAcrossMultipleOrgs } from "back-end/src/models/SdkConnectionModel";
import { _dangerousGetAllGrowthbookClickhouseDataSources } from "back-end/src/models/DataSourceModel";
import {
  _dangerouslyFindAllOrganizationsByIds,
  getOrganizationIdsWithTrackingDisabled,
} from "back-end/src/models/OrganizationModel";
import { getUsages } from "back-end/src/enterprise/billing";
import { licenseInit } from "back-end/src/enterprise";
import {
  getUserCodesForOrg,
  getLicenseMetaData,
} from "back-end/src/services/licenseData";
import { promiseAllChunks } from "back-end/src/util/promise";
import { logger } from "back-end/src/util/logger";

interface SdkInfo {
  organization: string;
  client_key: string;
  datasource: string;
  environment: string;
  overLimit: boolean;
}

interface GetDataEnrichmentResponse {
  sdkData: {
    [key: string]: SdkInfo;
  };
}

function sdkInfo(
  conn: SDKConnectionInterface,
  datasource: string,
  overLimit: boolean,
): SdkInfo {
  return {
    organization: conn.organization,
    client_key: conn.key,
    environment: conn.environment,
    datasource,
    overLimit,
  };
}

export const getDataEnrichment = createApiRequestHandler({
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
})(async (req): Promise<GetDataEnrichmentResponse> => {
  // Must be a super-user to make cross-org mongo queries
  await validateIsSuperUserRequest(req);

  const dataSources = await _dangerousGetAllGrowthbookClickhouseDataSources();
  const dataSourcesByOrgId = Object.fromEntries(
    dataSources.map((ds) => [ds.organization, ds.id]),
  );
  const orgIds = Object.keys(dataSourcesByOrgId);

  const orgIdsWithTrackingDisabled =
    await getOrganizationIdsWithTrackingDisabled(orgIds);

  const orgIdsWithTrackingEnabled = orgIds.filter(
    (x) => !orgIdsWithTrackingDisabled.has(x),
  );

  const sdkConnections = await _dangerousGetSdkConnectionsAcrossMultipleOrgs(
    orgIdsWithTrackingEnabled,
  );

  // TODO: Organizations can be large.  We only really need the fields that are used to determine effectivePlan.
  // If this endpoint becomes too slow or use too much memory we can project just those fields and the
  // downstream types.  Alternatively we can batch.
  const organizations = await _dangerouslyFindAllOrganizationsByIds(
    orgIdsWithTrackingEnabled,
  );

  // Initialize licenses for all organizations in batches to populate cache
  // getUsages relies on license data being in cache in order to calculate the effectivePlan
  await promiseAllChunks(
    organizations.map(
      (org) => () =>
        licenseInit(org, getUserCodesForOrg, getLicenseMetaData).catch((e) => {
          // Log error but don't fail the entire batch
          logger.error(
            `Data-enrichment endpoint: Failed to init license for org ${org.id}: ${e.message}`,
          );
        }),
    ),
    10,
  );

  const usages = await getUsages(organizations);

  const sdkData = Object.fromEntries(
    sdkConnections.map((conn) => [
      conn.key,
      sdkInfo(
        conn,
        dataSourcesByOrgId[conn.organization],
        usages[conn.organization]?.managedClickhouse?.status === "over" ||
          false,
      ),
    ]),
  );

  return { sdkData };
});

const router = Router();

// Mounted at /api/v1/ingestion
router.get("/data-enrichment", getDataEnrichment);

export default router;
