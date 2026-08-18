import { FeatureInterface } from "shared/types/feature";
import { OrganizationSettings } from "shared/types/organization";
import { ProjectInterface } from "../validators/projects";

/**
 * "Managed mode" is the simplified experiment implementation path: the
 * experiment owns exactly one Feature Flag, that flag holds exactly one
 * experiment-ref rule, and every change to it — values, review, publish,
 * eject — is made from the experiment page. The flag itself is closed to
 * direct edits for as long as it carries the marker.
 */

/** Characters a feature id may contain (see `postFeatures` in the back end). */
const FEATURE_KEY_ALLOWED = /[^a-zA-Z0-9_.:|-]+/g;

export function isManagedFeature(
  feature: Pick<FeatureInterface, "managedBy">,
): boolean {
  return feature.managedBy?.type === "experiment";
}

/**
 * True when `feature` is managed by exactly this experiment. Prefer it over a
 * bare `isManagedFeature` at any call site that already knows which experiment
 * it is acting for — a flag managed by a *different* experiment must be refused
 * there, not accepted.
 */
export function isManagedByExperiment(
  feature: Pick<FeatureInterface, "managedBy">,
  experimentId: string,
): boolean {
  return (
    feature.managedBy?.type === "experiment" &&
    feature.managedBy.experimentId === experimentId
  );
}

/**
 * Whether new experiments here default to managed mode. Project setting wins
 * when present; otherwise the org setting; absent everywhere reads as off so
 * orgs that predate the feature keep the manual flag workflow.
 */
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
 * Derive a legal feature id from an experiment's tracking key. Disallowed
 * characters collapse to a single `-`; a key that sanitizes to nothing falls
 * back to the experiment id, which is already key-legal.
 *
 * The result is a *candidate*, not a reservation — uniqueness belongs to the
 * `{id, organization}` unique index. Callers pass successive `attempt` values
 * on duplicate-key errors rather than probing for a free id first, because a
 * check-then-write leaves a window for a rival create to take the id in
 * between.
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
