import { findAuditByEntityList } from "back-end/src/models/AuditModel";
import { getWatchedByUser } from "back-end/src/models/WatchModel";
import { EntityType } from "shared/types/audit";
import { EntityTypes } from "shared/constants";

export function isValidAuditEntityType(type: string): type is EntityType {
  return EntityTypes.includes(type as EntityType);
}

export async function getRecentWatchedAudits(
  userId: string,
  organization: string,
) {
  const userWatches = await getWatchedByUser(organization, userId);

  if (!userWatches) {
    return [];
  }
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7);

  const experimentsFilter = {
    event: {
      $in: [
        "experiment.start",
        "experiment.stop",
        "experiment.phase",
        "experiment.results",
      ],
    },
    dateCreated: {
      $gte: startTime,
    },
  };

  const featuresFilter = {
    event: {
      $in: [
        "feature.publish",
        "feature.update",
        "feature.toggle",
        "feature.create",
        "feature.delete",
      ],
    },
    dateCreated: {
      $gte: startTime,
    },
  };

  const experiments = await findAuditByEntityList(
    organization,
    "experiment",
    userWatches.experiments,
    experimentsFilter,
  );

  const features = await findAuditByEntityList(
    organization,
    "feature",
    userWatches.features,
    featuresFilter,
  );

  const all = experiments
    .concat(features)
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime());
  return all;
}

export function auditDetailsCreate<T>(
  post: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    post,
    context,
  });
}
export function auditDetailsUpdate<T>(
  pre: T,
  post: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    pre,
    post,
    context,
  });
}

export function auditDetailsDelete<T>(
  pre: T,
  context: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    pre,
    context,
  });
}
