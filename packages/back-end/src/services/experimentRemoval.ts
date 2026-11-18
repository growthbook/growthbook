import {
  canMaterializeLinkedChanges,
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

const linkedChangesBlocked = (
  blocker: ExperimentLinkageBlocker,
  verb: string,
) =>
  new BadRequestError(
    blocker === "temporary-rollout"
      ? `This experiment's temporary rollout is still serving through its linked Feature Flags. Pass linkedChanges: "materialize" to keep the released variation as a permanent rule, or "remove" to stop serving it, before you ${verb} it.`
      : `This experiment is running. Pass linkedChanges: "remove" to acknowledge that its linked changes stop serving when you ${verb} it.`,
  );

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
  await resolveLinkedChanges(args, "archive");
  return updateExperiment({ context, experiment, changes });
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
