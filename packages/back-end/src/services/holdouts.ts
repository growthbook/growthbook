import { HoldoutInterface } from "shared/validators";
import { ExperimentInterface } from "shared/types/experiment";
import { FeatureInterface } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import {
  deleteExperimentByIdForOrganization,
  getExperimentsByIds,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import {
  getFeaturesByIds,
  removeHoldoutFromFeature,
} from "back-end/src/models/FeatureModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/services/organizations";
import { isHoldoutAvailableForProject } from "back-end/src/services/holdout-availability";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/holdouts";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { BadRequestError } from "back-end/src/util/errors";

export async function canLinkExperimentToHoldoutFromFeatures(
  context: ReqContext | ApiReqContext,
  holdoutId: string,
  featureIds: string[],
): Promise<boolean> {
  if (!featureIds.length) return false;
  const features = await getFeaturesByIds(context, featureIds);
  return features.some(
    (feature) =>
      feature.holdout?.id === holdoutId &&
      context.permissions.canUpdateFeature(feature, {}) &&
      context.permissions.canManageFeatureDrafts(feature),
  );
}

/**
 * Holdout-compatibility gate for adding an experiment-ref rule to a feature.
 *
 * `effectiveHoldout` is the holdout the rule will publish under, resolved by the
 * caller (the live `feature.holdout`, or the target revision's holdout when
 * posting to a different draft). Validation only — the linkage itself is derived
 * from published rules at publish time, so an abandoned draft leaves nothing to
 * unwind. The publish re-checks these constraints against live state.
 *
 * Incompatibilities throw via `makeError`, so REST handlers can surface a 400
 * (`BadRequestError`) while controllers get a plain `Error` (the default).
 */
export async function resolveHoldoutExperimentToLink({
  context,
  feature,
  experiment,
  effectiveHoldout,
  // `postFeatureExperimentRefRule` tolerates the experiment already being linked
  // to *this* feature (create-from-experiment); the other call sites reject any
  // pre-existing linked feature.
  allowExistingLinkToThisFeature = false,
  makeError = (message: string) => new Error(message),
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  experiment: ExperimentInterface;
  effectiveHoldout: { id: string } | null | undefined;
  allowExistingLinkToThisFeature?: boolean;
  makeError?: (message: string) => Error;
}): Promise<void> {
  if (effectiveHoldout?.id) {
    // Experiment already belongs to a different holdout — refuse the mismatch.
    if (experiment.holdoutId && experiment.holdoutId !== effectiveHoldout.id) {
      const featureHoldout = await context.models.holdout.getById(
        effectiveHoldout.id,
      );
      const expHoldout = await context.models.holdout.getById(
        experiment.holdoutId,
      );
      throw makeError(
        `Cannot add experiment rule: experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}" but this feature flag uses holdout "${featureHoldout?.name || effectiveHoldout.id}".`,
      );
    }

    // Not yet linked: validate it can join the holdout, then signal the caller
    // to perform the link.
    if (!experiment.holdoutId) {
      // Re-checked at publish, where it is what actually gates the linkage —
      // here so the rule is refused at edit time rather than at publish.
      const holdout = await context.models.holdout.getByIdForLinkage(
        effectiveHoldout.id,
      );
      if (
        holdout &&
        !isHoldoutAvailableForProject(holdout, experiment.project)
      ) {
        throw makeError(
          `Cannot add experiment rule: holdout "${holdout.name}" is not available in the experiment's Project.`,
        );
      }
      if (experiment.status !== "draft") {
        throw makeError(
          `Cannot add experiment rule: this feature flag uses a holdout, so the experiment must be in "draft" status (currently "${experiment.status ?? "unknown"}").`,
        );
      }
      const expHasLinkedChanges =
        (allowExistingLinkToThisFeature
          ? (experiment.linkedFeatures?.some((fid) => fid !== feature.id) ??
            false)
          : (experiment.linkedFeatures?.length ?? 0) > 0) ||
        experiment.hasURLRedirects ||
        experiment.hasVisualChangesets;
      if (expHasLinkedChanges) {
        throw makeError(
          `Cannot add experiment rule: this feature flag uses a holdout, but the experiment already has linked Feature Flags, URL redirects, or visual changesets. Unlink them first.`,
        );
      }
      return;
    }

    // Already linked to this same holdout: nothing to do.
    return;
  }

  // Feature is not in a holdout, but the experiment already belongs to one.
  if (experiment.holdoutId) {
    const expHoldout = await context.models.holdout.getById(
      experiment.holdoutId,
    );
    throw makeError(
      `Cannot add experiment rule: this experiment belongs to holdout "${expHoldout?.name || experiment.holdoutId}", but this feature flag is not in a holdout. Add the feature flag to that holdout first, then add the experiment.`,
    );
  }
}

/**
 * Delete a holdout along with its underlying experiment, unlink it from its
 * linked features and experiments, and refresh affected SDK payloads. Callers
 * are responsible for experiment-level permission checks; deleting the holdout
 * itself enforces canDeleteHoldout.
 */
export async function deleteHoldoutAndExperiment(
  context: ReqContext,
  holdout: HoldoutInterface,
  experiment: ExperimentInterface | null,
): Promise<void> {
  if (experiment) {
    await deleteExperimentByIdForOrganization(context, experiment);
  }

  // Remove holdout links from linked features and experiments
  const linkedFeatureIds = Object.keys(holdout.linkedFeatures);
  const linkedExperimentIds = Object.keys(holdout.linkedExperiments);
  const linkedFeatures = await getFeaturesByIds(context, linkedFeatureIds);
  const linkedExperiments = await getExperimentsByIds(
    context,
    linkedExperimentIds,
  );

  await Promise.all(
    linkedFeatures.map((f) => removeHoldoutFromFeature(context, f)),
  );
  await Promise.all(
    linkedExperiments.map((e) =>
      updateExperiment({
        context,
        experiment: e,
        changes: { holdoutId: "" },
      }),
    ),
  );

  await context.models.holdout.delete(holdout);

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getAffectedSDKPayloadKeys(
      holdout,
      getEnvironmentIdsFromOrg(context.org),
    ),
    auditContext: {
      event: "deleted",
      model: "holdout",
      id: holdout.id,
    },
  });
}

/**
 * Mirror of `getHoldoutAvailableForProject`, applied from the Holdout side:
 * narrowing a Holdout's Projects must not strand entities that are already
 * linked from outside the new scope. Without this, the same invalid pairing the
 * feature/experiment side refuses can be created by editing the Holdout, and a
 * project-scoped SDK Connection then drops the Holdout from its payload while
 * the Feature Flag still shows the rule.
 */
export async function assertHoldoutScopeCoversLinked(
  context: ReqContext | ApiReqContext,
  holdout: HoldoutInterface,
  projects: string[],
): Promise<void> {
  // No Projects means every Project, so nothing can fall outside.
  if (!projects.length) return;

  const covered = new Set(projects);
  const featureIds = Object.keys(holdout.linkedFeatures ?? {});
  const experimentIds = Object.keys(holdout.linkedExperiments ?? {});
  if (!featureIds.length && !experimentIds.length) return;

  const stranded: string[] = [];

  if (featureIds.length) {
    const features = await getFeaturesByIds(context, featureIds);
    for (const feature of features) {
      if (!covered.has(feature.project ?? "")) {
        stranded.push(`Feature Flag "${feature.id}"`);
      }
    }
  }

  if (experimentIds.length) {
    const experiments = await getExperimentsByIds(context, experimentIds);
    for (const experiment of experiments) {
      if (!covered.has(experiment.project ?? "")) {
        stranded.push(`Experiment "${experiment.name}"`);
      }
    }
  }

  if (stranded.length) {
    throw new BadRequestError(
      `${stranded.join(", ")} ${stranded.length > 1 ? "are" : "is"} linked to this Holdout but ${stranded.length > 1 ? "are" : "is"} not in the selected Projects. Remove ${stranded.length > 1 ? "them" : "it"} from the Holdout first.`,
    );
  }
}
