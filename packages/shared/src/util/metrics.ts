import { MetricInterface } from "shared/types/metric";
import { OrganizationSettings } from "shared/types/organization";

export const LEGACY_METRIC_CREATION_DISABLED_MESSAGE =
  "Legacy metric creation is disabled for this organization. Please use Fact Metrics instead.";

export type LegacyMetricCreationPermissions = {
  canCreateMetric: (
    metric: Pick<MetricInterface, "projects" | "managedBy">,
  ) => boolean;
};

export function isLegacyMetricCreationDisabled(
  settings?: Pick<OrganizationSettings, "disableLegacyMetricCreation"> | null,
): boolean {
  // Only treat explicit `true` as disabled. Existing orgs without this field
  // stored remain `undefined` and keep legacy metric creation enabled.
  return settings?.disableLegacyMetricCreation === true;
}

export function canCreateLegacyMetric(
  settings:
    | Pick<OrganizationSettings, "disableLegacyMetricCreation">
    | null
    | undefined,
  permissions: LegacyMetricCreationPermissions,
  metric: Pick<MetricInterface, "projects" | "managedBy">,
): boolean {
  if (isLegacyMetricCreationDisabled(settings)) {
    return false;
  }

  return permissions.canCreateMetric(metric);
}
