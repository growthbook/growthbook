import type { HoldoutInterface } from "shared/validators";
import { getEnabledHoldoutEnvironments, HoldoutStage } from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";
import { createEvent } from "back-end/src/models/EventModel";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getOwnerEmail } from "back-end/src/services/owner";
import { logger } from "back-end/src/util/logger";

// The fields every holdout payload opens with. The owner lives on the
// holdout's backing experiment; failing to read it must not cost the event.
async function holdoutIdentity(context: Context, holdout: HoldoutInterface) {
  let ownerEmail: string | undefined;
  try {
    const experiment = await getExperimentById(context, holdout.experimentId);
    ownerEmail = await getOwnerEmail(experiment?.owner, context);
  } catch (error) {
    logger.warn(error, "Failed to resolve holdout owner for notification");
  }
  return {
    holdoutId: holdout.id,
    holdoutName: holdout.name,
    ...(ownerEmail ? { ownerEmail } : {}),
  };
}

export async function notifyHoldoutCreated({
  context,
  holdout,
}: {
  context: Context;
  holdout: HoldoutInterface;
}): Promise<void> {
  try {
    await createEvent({
      context,
      object: "holdout",
      objectId: holdout.id,
      event: "created",
      data: { object: await holdoutIdentity(context, holdout) },
      projects: holdout.projects,
      tags: [],
      environments: getEnabledHoldoutEnvironments(holdout.environmentSettings),
      containsSecrets: false,
    });
  } catch (error) {
    logger.error(error, "Failed to notify holdout creation");
  }
}

export async function notifyHoldoutStatusChanged({
  context,
  holdout,
  previousStatus,
  currentStatus,
}: {
  context: Context;
  holdout: HoldoutInterface;
  previousStatus: HoldoutStage;
  currentStatus: HoldoutStage;
}): Promise<void> {
  if (previousStatus === currentStatus) return;
  try {
    await createEvent({
      context,
      object: "holdout",
      objectId: holdout.id,
      event: "status.changed",
      data: {
        object: {
          ...(await holdoutIdentity(context, holdout)),
          previousStatus,
          currentStatus,
        },
      },
      projects: holdout.projects,
      tags: [],
      environments: getEnabledHoldoutEnvironments(holdout.environmentSettings),
      containsSecrets: false,
    });
  } catch (error) {
    logger.error(error, "Failed to notify holdout status change");
  }
}

export async function notifyHoldoutNewLinkage({
  context,
  previous,
  holdout,
}: {
  context: Context;
  previous: HoldoutInterface;
  holdout: HoldoutInterface;
}): Promise<void> {
  const featureIds = Object.keys(holdout.linkedFeatures).filter(
    (id) => !Object.prototype.hasOwnProperty.call(previous.linkedFeatures, id),
  );
  const experimentIds = Object.keys(holdout.linkedExperiments).filter(
    (id) =>
      !Object.prototype.hasOwnProperty.call(previous.linkedExperiments, id),
  );
  if (!featureIds.length && !experimentIds.length) return;
  try {
    await createEvent({
      context,
      object: "holdout",
      objectId: holdout.id,
      event: "config.newLinkage",
      data: {
        object: {
          ...(await holdoutIdentity(context, holdout)),
          featureIds,
          experimentIds,
        },
      },
      projects: holdout.projects,
      tags: [],
      environments: getEnabledHoldoutEnvironments(holdout.environmentSettings),
      containsSecrets: false,
    });
  } catch (error) {
    logger.error(error, "Failed to notify new holdout linkage");
  }
}
