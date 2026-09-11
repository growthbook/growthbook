import type { HoldoutInterface } from "shared/validators";
import { getEnabledHoldoutEnvironments, HoldoutStage } from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";
import { createEvent } from "back-end/src/models/EventModel";
import { logger } from "back-end/src/util/logger";

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
      data: { object: { holdoutId: holdout.id, holdoutName: holdout.name } },
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
          holdoutId: holdout.id,
          holdoutName: holdout.name,
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
          holdoutId: holdout.id,
          holdoutName: holdout.name,
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
