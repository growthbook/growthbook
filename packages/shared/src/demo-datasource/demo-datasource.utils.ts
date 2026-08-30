const DEMO_PROJECT_ID_SEPARATOR = "_";
const DEMO_PROJECT_ID_SUFFIX = "demo-datasource-project";

/** Host used by the built-in Sample Data postgres connection. */
export const DEMO_DATASOURCE_HOST = "sample-data.growthbook.io";

// Constant IDs for seeded sample resources. These collections are unique per
// (organization, id), so every org holds its own copy under the same ID and
// the ID itself is the provenance marker used to delete or reset sample data.
// Project IDs are globally unique, so the project ID stays org-derived.
export const DEMO_DATASOURCE_ID = "ds_demo-datasource-project";
export const DEMO_EXPERIMENT_ID = "exp_demo-datasource-project";
export const DEMO_EXPERIMENT_TRACKING_KEY = "gbdemo-add-to-cart-cta";
export const DEMO_FACT_TABLE_IDS = {
  purchases: "ftb_demo-purchases",
  pageViews: "ftb_demo-page-views",
} as const;
export const DEMO_FACT_METRIC_IDS = {
  revenuePerUser: "fact__demo-revenue-per-user",
  anyPurchases: "fact__demo-any-purchases",
  d7PurchaseRetention: "fact__demo-d7-purchase-retention",
  averageOrderValue: "fact__demo-average-order-value",
} as const;

/**
 * Returns the demo project ID to support the demo datasource project.
 * e.g. prj_org-abc123_demo-datasource-project
 * @param organizationId
 */
export function getDemoDatasourceProjectIdForOrganization(
  organizationId?: string,
): string {
  return (
    "prj" +
    DEMO_PROJECT_ID_SEPARATOR +
    organizationId +
    DEMO_PROJECT_ID_SEPARATOR +
    DEMO_PROJECT_ID_SUFFIX
  );
}

export function getDefaultProjectsForNewResource({
  project,
  organizationId,
}: {
  project?: string;
  organizationId?: string;
}): string[] {
  if (!project) return [];
  if (
    organizationId &&
    isDemoDatasourceProject({ projectId: project, organizationId })
  ) {
    return [];
  }
  return [project];
}

/**
 * Fact table IDs used by sample data before they were constant (org-prefixed).
 * Kept so delete/reset can still remove those leftovers.
 */
export function getLegacyDemoFactTableIds(organizationId: string): string[] {
  return [
    "ftb" +
      DEMO_PROJECT_ID_SEPARATOR +
      organizationId +
      DEMO_PROJECT_ID_SEPARATOR +
      DEMO_PROJECT_ID_SUFFIX,
    "ftb" +
      DEMO_PROJECT_ID_SEPARATOR +
      organizationId +
      DEMO_PROJECT_ID_SEPARATOR +
      "demo-datasource-page-views",
  ];
}

/**
 * Verifies if the provided project ID is the organization's demo datasource project ID
 * @param projectId
 * @param organizationId
 */
export function isDemoDatasourceProject({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId?: string;
}): boolean {
  const demoId = getDemoDatasourceProjectIdForOrganization(organizationId);

  return projectId === demoId;
}

/**
 * Feature ID for the demo project
 */
export const getDemoDataSourceFeatureId = (): string =>
  "gbdemo-checkout-layout";

/**
 * Sample Data Sources are identified by the constant ID, or — for orgs seeded
 * before constant IDs — by the shared sample-data postgres host restricted to
 * the Sample Data project. Must stay in sync with the back-end's
 * getSampleDatasourceIds, which applies the same rule to decide what "Delete
 * Sample Data" removes.
 */
export function isSampleDatasource({
  datasourceId,
  type,
  host,
  projects,
  organizationId,
}: {
  datasourceId?: string;
  type?: string;
  host?: string;
  projects?: string[];
  organizationId?: string;
}): boolean {
  if (datasourceId === DEMO_DATASOURCE_ID) return true;
  if (!organizationId) return false;
  return (
    type === "postgres" &&
    host === DEMO_DATASOURCE_HOST &&
    (projects ?? []).includes(
      getDemoDatasourceProjectIdForOrganization(organizationId),
    )
  );
}
