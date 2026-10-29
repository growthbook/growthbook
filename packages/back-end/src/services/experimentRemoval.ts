import {
  canMaterializeLinkedChanges,
  getExperimentLinkageBlocker,
  isManagedByExperiment,
  type ExperimentLinkageBlocker,
  type LinkedChangesResolution,
} from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { EventUser } from "shared/types/events/event-types";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import { getFeaturesByIds } from "back-end/src/models/FeatureModel";
import {
  deleteExperimentByIdForOrganization,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { getLinkedFeatureInfo } from "back-end/src/services/experiments";
import { removeExperimentFromPresentations } from "back-end/src/services/presentations";
import { validateExperimentChange } from "back-end/src/services/experimentChanges/changeExperimentStatus";
import { logger } from "back-end/src/util/logger";
import { getLinkageSyncRevisionSummaries } from "back-end/src/models/FeatureRevisionModel";
import { syncFeatureExperimentLinkages } from "back-end/src/util/featureExperimentSync";
import {
  materializeExperimentRules,
  removeRulesForDeletedExperiment,
} from "./experiment-feature";
import {
  assertLinkedFlagsReadable,
  clearManagedMarkersForExperiment,
} from "./managedFeatures";

const linkedChangesBlocked = (
  blocker: ExperimentLinkageBlocker,
  verb: string,
) =>
  new BadRequestError(
    blocker === "temporary-rollout"
      ? `This experiment's temporary rollout is still serving through its linked Feature Flags. Pass linkedChanges: "materialize" to keep the released variation as a permanent rule, or "remove" to stop serving it, before you ${verb} it.`
      : `This experiment is running. Pass linkedChanges: "remove" to acknowledge that its linked changes stop serving when you ${verb} it.`,
  );

type Args = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  linkedChanges?: LinkedChangesResolution;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  restApiBypassesReviews?: boolean;
};

async function assertLinkedChangesResolvable(
  {
    context,
    experiment,
    linkedChanges,
  }: Pick<Args, "context" | "experiment" | "linkedChanges">,
  verb: string,
): Promise<void> {
  // The blocker and the cleanup only see readable flags.
  await assertLinkedFlagsReadable(context, experiment);
  const info = await getLinkedFeatureInfo(context, experiment);
  const blocker = getExperimentLinkageBlocker(experiment, info);
  if (blocker && !linkedChanges) {
    throw linkedChangesBlocked(blocker, verb);
  }
  if (
    linkedChanges === "materialize" &&
    !canMaterializeLinkedChanges(experiment, blocker)
  ) {
    throw new BadRequestError(
      "Only a stopped experiment with a temporary rollout on Feature Flags, and no namespace, can keep its released variation as a permanent rule.",
    );
  }
}

// Returns true when the rules were frozen in place.
async function resolveLinkedChanges(
  args: Args,
  verb: string,
): Promise<boolean> {
  const {
    context,
    experiment,
    linkedChanges,
    eventAudit,
    audit,
    restApiBypassesReviews,
  } = args;
  await assertLinkedChangesResolvable(args, verb);
  if (linkedChanges !== "materialize") return false;
  await materializeExperimentRules({
    context,
    experiment,
    features: await getFeaturesByIds(context, experiment.linkedFeatures ?? []),
    eventAudit,
    audit,
    restApiBypassesReviews,
  });
  // The managed flag now serves the value on its own; hand it back rather
  // than archiving it.
  await clearManagedMarkersForExperiment(context, experiment.id, {
    archive: false,
  });
  return true;
}

export async function deleteExperimentWithCleanup(args: Args): Promise<void> {
  const { context, experiment, eventAudit, audit, restApiBypassesReviews } =
    args;
  const materialized = await resolveLinkedChanges(args, "delete");
  if (!materialized) {
    const linkedFeatures = await getFeaturesByIds(
      context,
      experiment.linkedFeatures ?? [],
    );
    // Shared flags lose the rule that would point at nothing; the managed flag
    // is archived whole.
    await removeRulesForDeletedExperiment({
      context,
      experiment,
      features: linkedFeatures.filter(
        (f) => !isManagedByExperiment(f, experiment.id),
      ),
      eventAudit,
      audit,
      restApiBypassesReviews,
    });
    // Release first, or the flag survives pointing at a deleted experiment.
    await clearManagedMarkersForExperiment(context, experiment.id);
  }

  await Promise.all([
    deleteExperimentByIdForOrganization(context, experiment),
    removeExperimentFromPresentations(experiment.id),
  ]);

  if (experiment.holdoutId) {
    try {
      await context.models.holdout.removeExperimentFromHoldout(
        experiment.holdoutId,
        experiment.id,
      );
    } catch (e) {
      logger.warn(e, "Error removing experiment from holdout");
    }
  }
}

// Everything an archive can refuse on, for a caller that checks before writing.
export async function assertCanArchive(
  args: Pick<Args, "context" | "experiment" | "linkedChanges">,
): Promise<void> {
  await validateExperimentChange({
    context: args.context,
    experiment: args.experiment,
    changes: { archived: true },
  });
  await assertLinkedChangesResolvable(args, "archive");
}

export async function archiveExperimentWithCleanup(
  args: Args,
): Promise<ExperimentInterface> {
  const { context, experiment } = args;
  const changes = { archived: true };
  await validateExperimentChange({ context, experiment, changes });
  const materialized = await resolveLinkedChanges(args, "archive");
  // The released flag is an ordinary linked flag now, as after an eject.
  const released = materialized && experiment.implementationType === "values";
  return updateExperiment({
    context,
    experiment,
    changes: {
      ...changes,
      ...(released && { implementationType: "feature" as const }),
    },
  });
}

export async function unarchiveExperimentWithCleanup({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}): Promise<ExperimentInterface> {
  const changes = { archived: false };
  await validateExperimentChange({ context, experiment, changes });
  const updated = await updateExperiment({ context, experiment, changes });

  // Archiving cleared pendingFeatureDrafts; rebuild the queue from each linked
  // flag's revisions. Fire-and-forget.
  const linkedFeatureIds = experiment.linkedFeatures ?? [];
  if (linkedFeatureIds.length > 0) {
    Promise.all(
      linkedFeatureIds.map(async (featureId) => {
        const { openDrafts, liveRevision } =
          await getLinkageSyncRevisionSummaries(context.org.id, featureId);
        return syncFeatureExperimentLinkages(
          context,
          featureId,
          openDrafts,
          liveRevision,
        );
      }),
    ).catch((e) => {
      logger.error(e, "syncFeatureExperimentLinkages failed on unarchive");
    });
  }
  return updated;
}
