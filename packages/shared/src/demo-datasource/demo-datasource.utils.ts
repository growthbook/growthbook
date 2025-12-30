const DEMO_PROJECT_ID_SEPARATOR = "_";
const DEMO_PROJECT_ID_SUFFIX = "demo-datasource-project";

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
