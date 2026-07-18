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

/**
 * Default `projects` for a newly created resource based on the current project
 * selection. Never seeds the Sample Data project — that project is reserved for
 * imported demo resources and tagging other resources with it locks them into
 * the frontend readonly override.
 */
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
 * Returns the demo fact table ID to support the demo datasource project.
 * e.g. ftb_org-abc123_demo-datasource-project
 * @param organizationId
 */
export function getDemoDatasourceFactTableIdForOrganization(
  organizationId?: string,
): string {
  return (
    "ftb" +
    DEMO_PROJECT_ID_SEPARATOR +
    organizationId +
    DEMO_PROJECT_ID_SEPARATOR +
    DEMO_PROJECT_ID_SUFFIX
  );
}

/**
 * Returns the demo page_views fact table ID.
 * e.g. ftb_org-abc123_demo-datasource-page-views
 * @param organizationId
 */
export function getDemoDatasourcePageViewsFactTableIdForOrganization(
  organizationId?: string,
): string {
  return (
    "ftb" +
    DEMO_PROJECT_ID_SEPARATOR +
    organizationId +
    DEMO_PROJECT_ID_SEPARATOR +
    "demo-datasource-page-views"
  );
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
 * The complete set of IDs the sample data seeder creates for an organization.
 * Reset targets exactly this set. Full delete also removes any other resources
 * built on the sample Data Source.
 */
export function getDemoResourceIds(organizationId: string): {
  projectId: string;
  datasourceId: string;
  factTableIds: string[];
  factMetricIds: string[];
  experimentId: string;
  featureId: string;
} {
  return {
    projectId: getDemoDatasourceProjectIdForOrganization(organizationId),
    datasourceId: DEMO_DATASOURCE_ID,
    factTableIds: [
      getDemoDatasourceFactTableIdForOrganization(organizationId),
      getDemoDatasourcePageViewsFactTableIdForOrganization(organizationId),
    ],
    factMetricIds: Object.values(DEMO_FACT_METRIC_IDS),
    experimentId: DEMO_EXPERIMENT_ID,
    featureId: getDemoDataSourceFeatureId(),
  };
}
