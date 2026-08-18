import { FeatureInterface } from "shared/types/feature";
import { OrganizationSettings } from "shared/types/organization";
import { ProjectInterface } from "../validators/projects";

// Managed mode: the experiment owns one Feature Flag holding one experiment-ref
// rule, edited only from the experiment page while the marker is set.

/** Characters a feature id may contain (see `postFeatures`). */
const FEATURE_KEY_ALLOWED = /[^a-zA-Z0-9_.:|-]+/g;

export function isManagedFeature(
  feature: Pick<FeatureInterface, "managedBy">,
): boolean {
  return feature.managedBy?.type === "experiment";
}

export function isManagedByExperiment(
  feature: Pick<FeatureInterface, "managedBy">,
  experimentId: string,
): boolean {
  return (
    feature.managedBy?.type === "experiment" &&
    feature.managedBy.experimentId === experimentId
  );
}

/** Project setting wins when set; absent everywhere reads as off. */
export function managedExperimentFlagsDefault({
  settings,
  project,
}: {
  settings?: OrganizationSettings;
  project?: Pick<ProjectInterface, "settings"> | null;
}): boolean {
  const projectSetting = project?.settings?.managedExperimentFlags;
  if (projectSetting !== undefined) return projectSetting;
  return settings?.managedExperimentFlags ?? false;
}

/**
 * A candidate id, not a reservation: uniqueness belongs to the
 * `{id, organization}` index, so callers bump `attempt` on duplicate-key errors
 * rather than probing for a free id and racing.
 */
export function managedFeatureKeyCandidate({
  trackingKey,
  experimentId,
  attempt = 0,
}: {
  trackingKey: string;
  experimentId: string;
  attempt?: number;
}): string {
  const sanitized = trackingKey
    .trim()
    .replace(FEATURE_KEY_ALLOWED, "-")
    .replace(/^-+|-+$/g, "");
  const base = sanitized || experimentId;
  return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

/** Creation collects no values, so each variation starts serving its own key. */
export function seedManagedVariationValues(
  variations: { id: string; key?: string }[],
): { variationId: string; value: string }[] {
  return variations.map((v, i) => ({
    variationId: v.id,
    value: v.key || String(i),
  }));
}

/**
 * By position, not by variation id — a duplicate gets fresh ids, so an id match
 * would fall back to the seed for every variation. Uncovered positions seed.
 */
export function copyManagedVariationValues({
  sourceValues,
  sourceVariations,
  targetVariations,
}: {
  sourceValues: { variationId: string; value: string }[];
  sourceVariations: { id: string }[];
  targetVariations: { id: string; key?: string }[];
}): { variationId: string; value: string }[] {
  const byIndex = sourceVariations.map(
    (sv) => sourceValues.find((v) => v.variationId === sv.id)?.value,
  );
  const seeded = seedManagedVariationValues(targetVariations);
  return targetVariations.map((v, i) => ({
    variationId: v.id,
    value: byIndex[i] ?? seeded[i].value,
  }));
}
