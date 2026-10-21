import {
  canMaterializeLinkedChanges,
  getAffectedEnvsForExperiment,
  getExperimentLinkageBlocker,
  PermissionError,
  type ExperimentLinkageBlocker,
  type LinkedChangesResolution,
} from "shared/util";
import { ExperimentInterface } from "shared/types/experiment";
import { EventUser } from "shared/types/events/event-types";
import type { AuditInterfaceInput } from "shared/types/audit";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { BadRequestError } from "back-end/src/util/errors";
import {
  getFeatureProjectsByIds,
  getFeaturesByIds,
} from "back-end/src/models/FeatureModel";
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

export class LinkedChangesBlockedError extends BadRequestError {
  blocker: ExperimentLinkageBlocker;
  constructor(blocker: ExperimentLinkageBlocker, verb: string) {
    super(
      blocker === "temporary-rollout"
        ? `This experiment's temporary rollout is still serving through its linked Feature Flags. Pass linkedChanges: "materialize" to keep the released variation as a permanent rule, or "remove" to stop serving it, before you ${verb} it.`
        : `This experiment is running. Pass linkedChanges: "remove" to acknowledge that its linked changes stop serving when you ${verb} it.`,
    );
    this.blocker = blocker;
  }
}

// Taking an experiment out of the payload, or putting it back, is a run-class
// change on every environment its linked changes reach.
export async function assertCanChangeServing(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  const linkedFeatures = await getFeaturesByIds(
    context,
    experiment.linkedFeatures ?? [],
  );
  const envs = getAffectedEnvsForExperiment({
    experiment,
    orgEnvironments: context.org.settings?.environments || [],
    linkedFeatures,
  });
  if (
    envs.length > 0 &&
    !context.permissions.canRunExperiment(experiment, envs)
  ) {
    context.permissions.throwPermissionError();
  }
}

// Skipping an unreadable flag is how rules outlive their experiment.
async function assertLinkedFlagsReadable(
  context: ReqContext | ApiReqContext,
  experiment: ExperimentInterface,
): Promise<void> {
  const ids = experiment.linkedFeatures ?? [];
  if (!ids.length) return;
  const existing = await getFeatureProjectsByIds(context, ids);
  const readable = new Set(
    (await getFeaturesByIds(context, ids)).map((f) => f.id),
  );
  const unreadable = Array.from(existing.keys()).filter(
    (id) => !readable.has(id),
  );
  if (!unreadable.length) return;
  const list = unreadable.map((id) => `"${id}"`).join(", ");
  throw new PermissionError(
    unreadable.length === 1
      ? `Feature Flag ${list} is linked to this experiment but you cannot access it, so this change cannot be made. Ask someone with access to that Feature Flag's project.`
      : `Feature Flags ${list} are linked to this experiment but you cannot access them, so this change cannot be made. Ask someone with access to those Feature Flags' projects.`,
  );
}

type Args = {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
  linkedChanges?: LinkedChangesResolution;
  eventAudit: EventUser;
  audit: (data: AuditInterfaceInput) => Promise<void>;
  /** A REST call in an org that lets the REST API skip approval. */
  restApiBypassesReviews?: boolean;
};

// Returns true when the rules were frozen in place.
async function resolveLinkedChanges(
  {
    context,
    experiment,
    linkedChanges,
    eventAudit,
    audit,
    restApiBypassesReviews,
  }: Args,
  verb: string,
): Promise<boolean> {
  // The blocker and the cleanup only see readable flags.
  await assertLinkedFlagsReadable(context, experiment);
  const info = await getLinkedFeatureInfo(context, experiment);
  const blocker = getExperimentLinkageBlocker(experiment, info);
  if (blocker && !linkedChanges) {
    throw new LinkedChangesBlockedError(blocker, verb);
  }
  if (linkedChanges !== "materialize") return false;
  if (!canMaterializeLinkedChanges(experiment, blocker)) {
    throw new BadRequestError(
      "Only a stopped experiment with a temporary rollout on Feature Flags, and no namespace, can keep its released variation as a permanent rule.",
    );
  }
  await materializeExperimentRules({
    context,
    experiment,
    features: await getFeaturesByIds(context, experiment.linkedFeatures ?? []),
    eventAudit,
    audit,
    restApiBypassesReviews,
  });
  return true;
}

export async function deleteExperimentWithCleanup(args: Args): Promise<void> {
  const { context, experiment, eventAudit, audit, restApiBypassesReviews } =
    args;
  const materialized = await resolveLinkedChanges(args, "delete");
  if (!materialized) {
    // Linked flags lose the rule that would point at nothing.
    await removeRulesForDeletedExperiment({
      context,
      experiment,
      features: await getFeaturesByIds(
        context,
        experiment.linkedFeatures ?? [],
      ),
      eventAudit,
      audit,
      restApiBypassesReviews,
    });
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

export async function archiveExperimentWithCleanup(
  args: Args,
): Promise<ExperimentInterface> {
  const { context, experiment } = args;
  await validateExperimentChange({
    context,
    experiment,
    changes: { archived: true },
  });
  await resolveLinkedChanges(args, "archive");
  return updateExperiment({
    context,
    experiment,
    changes: { archived: true },
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
