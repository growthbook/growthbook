import type { Namespaces } from "shared/types/organization";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { countActiveExperimentsUsingNamespace } from "back-end/src/models/ExperimentModel";
import { countFeaturesWithExperimentRuleInNamespace } from "back-end/src/models/FeatureModel";
import { ConflictError } from "back-end/src/util/errors";

// A namespace is "in use" while any experiment that still contributes to SDK
// payloads has it enabled on its latest phase, or any feature carries an
// enabled inline experiment rule in it — the same usage the namespaces settings
// page shows. Deleting such a namespace, or changing the hash attribute of a
// multi-range one, re-buckets that traffic, so the dashboard and REST routes
// both refuse it. The counts are org-wide (not narrowed to what the caller can
// read), because traffic the caller cannot see is re-bucketed all the same.
export async function assertNamespaceNotInUse(
  context: ReqContext | ApiReqContext,
  namespaceId: string,
  action: "delete" | "change the hash attribute of",
): Promise<void> {
  const [experiments, features] = await Promise.all([
    countActiveExperimentsUsingNamespace(context, namespaceId),
    countFeaturesWithExperimentRuleInNamespace(context, namespaceId),
  ]);
  if (experiments === 0 && features === 0) return;
  const parts: string[] = [];
  if (experiments) parts.push(`${experiments} experiment(s)`);
  if (features) parts.push(`${features} feature experiment rule(s)`);
  throw new ConflictError(
    `Cannot ${action} a namespace that is in use by ${parts.join(" and ")}.`,
  );
}

// A hash-attribute edit only matters for a multi-range namespace whose stored
// attribute differs; resending the current value (as the settings page does on
// every edit) is not a change.
export async function assertNamespaceHashAttributeChangeAllowed(
  context: ReqContext | ApiReqContext,
  existing: Namespaces,
  hashAttribute: string | undefined,
): Promise<void> {
  if (!hashAttribute || existing.format !== "multiRange") return;
  if (hashAttribute === existing.hashAttribute) return;
  await assertNamespaceNotInUse(
    context,
    existing.name,
    "change the hash attribute of",
  );
}
