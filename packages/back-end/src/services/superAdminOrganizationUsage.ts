import { OrganizationInterface } from "shared/types/organization";
import { _dangerourslyGetAllDatasourcesByOrganizations } from "back-end/src/models/DataSourceModel";
import { getCollection } from "back-end/src/util/mongo.util";
import { logger } from "back-end/src/util/logger";
import { getNumberOfUniqueMembersAndInvites } from "back-end/src/services/organizations";
import { countManagedWarehouseEventsForOrganization } from "back-end/src/services/clickhouse";

export type SuperAdminOrganizationUsage = {
  seats: {
    fullMembers: number;
    readonlyMembers: number;
    invited: number;
    overall: number;
  };
  activity: {
    activeMembers: { past30: number; past365: number };
    experimentsCreated: { past30: number; past365: number };
    featuresCreated: { past30: number; past365: number };
    metricsCreated: { past30: number; past365: number };
    productAnalyticsDashboardsCreated: { past30: number; past365: number };
    sdkConnectionsCreated: { past30: number; past365: number };
  };
  managedWarehouse: boolean;
  managedWarehouseEvents: {
    past30: number | null;
    past365: number | null;
  } | null;
  current: {
    dataSourceTypes: string[];
    metricsTotal: number;
    runningExperiments: number;
    draftExperiments: number;
    activeFeatureFlags: number;
  };
};

function uniqueMembers(org: OrganizationInterface) {
  return [...new Map(org.members.map((m) => [m.id, m])).values()];
}

function generalProductAnalyticsDashboardFilter(orgId: string) {
  return {
    organization: orgId,
    isDeleted: { $ne: true },
    $or: [
      { experimentId: { $exists: false } },
      { experimentId: null },
      { experimentId: "" },
    ],
  };
}

export async function getSuperAdminOrganizationUsage(
  org: OrganizationInterface,
): Promise<SuperAdminOrganizationUsage> {
  const orgId = org.id;
  const now = new Date();
  const past30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const past365 = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const members = uniqueMembers(org);
  let fullMembers = 0;
  let readonlyMembers = 0;
  for (const m of members) {
    if (m.role === "readonly") {
      readonlyMembers += 1;
    } else {
      fullMembers += 1;
    }
  }

  const invited = new Set((org.invites ?? []).map((i) => i.email.toLowerCase()))
    .size;

  const activeSince = (since: Date) =>
    members.filter((m) => {
      const d = m.lastLoginDate;
      return d && new Date(d) >= since;
    }).length;

  const experiments = getCollection("experiments");
  const features = getCollection("features");
  const metrics = getCollection("metrics");
  const factmetrics = getCollection("factmetrics");
  const dashboards = getCollection("dashboards");
  const sdkconnections = getCollection("sdkconnections");

  const [
    datasources,
    experimentsCreated30,
    experimentsCreated365,
    featuresCreated30,
    featuresCreated365,
    legacyMetricsCreated30,
    legacyMetricsCreated365,
    factMetricsCreated30,
    factMetricsCreated365,
    paDashboardsCreated30,
    paDashboardsCreated365,
    sdkCreated30,
    sdkCreated365,
    legacyMetricTotal,
    factMetricTotal,
    runningExperiments,
    draftExperiments,
    activeFeatureFlags,
  ] = await Promise.all([
    _dangerourslyGetAllDatasourcesByOrganizations([orgId]),
    experiments.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past30, $lte: now },
    }),
    experiments.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past365, $lte: now },
    }),
    features.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past30, $lte: now },
    }),
    features.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past365, $lte: now },
    }),
    metrics.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past30, $lte: now },
    }),
    metrics.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past365, $lte: now },
    }),
    factmetrics.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past30, $lte: now },
    }),
    factmetrics.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past365, $lte: now },
    }),
    dashboards.countDocuments({
      ...generalProductAnalyticsDashboardFilter(orgId),
      dateCreated: { $gte: past30, $lte: now },
    }),
    dashboards.countDocuments({
      ...generalProductAnalyticsDashboardFilter(orgId),
      dateCreated: { $gte: past365, $lte: now },
    }),
    sdkconnections.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past30, $lte: now },
    }),
    sdkconnections.countDocuments({
      organization: orgId,
      dateCreated: { $gte: past365, $lte: now },
    }),
    metrics.countDocuments({ organization: orgId }),
    factmetrics.countDocuments({ organization: orgId }),
    experiments.countDocuments({
      organization: orgId,
      status: "running",
      archived: { $ne: true },
    }),
    experiments.countDocuments({
      organization: orgId,
      status: "draft",
      archived: { $ne: true },
    }),
    features.countDocuments({
      organization: orgId,
      archived: { $ne: true },
    }),
  ]);

  const managedWarehouse = datasources.some(
    (d) => d.type === "growthbook_clickhouse",
  );

  let managedWarehouseEvents: SuperAdminOrganizationUsage["managedWarehouseEvents"] =
    null;
  if (managedWarehouse) {
    try {
      const [past30Count, past365Count] = await Promise.all([
        countManagedWarehouseEventsForOrganization(orgId, past30, now),
        countManagedWarehouseEventsForOrganization(orgId, past365, now),
      ]);
      managedWarehouseEvents = {
        past30: past30Count,
        past365: past365Count,
      };
    } catch (e) {
      logger.error(e, "Failed to load managed warehouse event counts");
      managedWarehouseEvents = { past30: null, past365: null };
    }
  }

  const dataSourceTypes = [
    ...new Set(datasources.map((d) => d.type).filter(Boolean)),
  ].sort();

  return {
    seats: {
      fullMembers,
      readonlyMembers,
      invited,
      overall: getNumberOfUniqueMembersAndInvites(org),
    },
    activity: {
      activeMembers: {
        past30: activeSince(past30),
        past365: activeSince(past365),
      },
      experimentsCreated: {
        past30: experimentsCreated30,
        past365: experimentsCreated365,
      },
      featuresCreated: {
        past30: featuresCreated30,
        past365: featuresCreated365,
      },
      metricsCreated: {
        past30: legacyMetricsCreated30 + factMetricsCreated30,
        past365: legacyMetricsCreated365 + factMetricsCreated365,
      },
      productAnalyticsDashboardsCreated: {
        past30: paDashboardsCreated30,
        past365: paDashboardsCreated365,
      },
      sdkConnectionsCreated: {
        past30: sdkCreated30,
        past365: sdkCreated365,
      },
    },
    managedWarehouse,
    managedWarehouseEvents,
    current: {
      dataSourceTypes,
      metricsTotal: legacyMetricTotal + factMetricTotal,
      runningExperiments,
      draftExperiments,
      activeFeatureFlags,
    },
  };
}
