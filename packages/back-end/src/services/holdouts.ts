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
import { getAffectedSDKPayloadKeys } from "back-end/src/util/holdouts";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";

/**
 * Eagerly link an experiment into a holdout: set `experiment.holdoutId` and add
 * the experiment to the holdout's `linkedExperiments` map. The write-side
 * companion to `resolveHoldoutExperimentToLink` — call it with the experiment
 * that resolver returned.
 *
 * Callers that compensate on downstream failure should record the experiment
 * and holdout ids BEFORE calling: the standard rollback (clear `holdoutId`,
 * remove the map entry if present) is idempotent, so compensating a write that
 * never happened is harmless, while the reverse ordering would leave a
 * mid-failure (experiment written, holdout write failed) uncompensated.
 */
export async function linkExperimentToHoldout(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
  holdoutId: string,
): Promise<void> {
  await updateExperiment({
    context,
    experiment,
    changes: { holdoutId },
  });
  const holdout = await context.models.holdout.getById(holdoutId);
  await context.models.holdout.updateById(holdoutId, {
    linkedExperiments: {
      ...holdout?.linkedExperiments,
      [experiment.id]: { id: experiment.id, dateAdded: new Date() },
    },
  });
}

/**
 * Holdout-compatibility gate for adding an experiment-ref rule to a feature.
 *
 * `effectiveHoldout` is the holdout the rule will publish under, resolved by the
 * caller (the live `feature.holdout`, or the target revision's holdout when
 * posting to a different draft). Given the referenced `experiment`, this
 * enforces the constraints for attaching an experiment to a holdout and returns
 * the experiment that should be eagerly linked, or `null` when no linking is
 * needed (experiment already in this holdout, or neither side uses a holdout).
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
}): Promise<ExperimentInterface | null> {
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
      return experiment;
    }

    // Already linked to this same holdout: nothing to do.
    return null;
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

  return null;
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
