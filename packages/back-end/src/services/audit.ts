import { EntityType } from "shared/types/audit";
import { entityTypes } from "shared/constants";
import { findAuditByEntityList } from "back-end/src/models/AuditModel";
import { ReqContext } from "back-end/types/request";

export function isValidAuditEntityType(type: string): type is EntityType {
  return entityTypes.includes(type as EntityType);
}

export async function getRecentWatchedAudits(
  context: ReqContext,
  userId: string,
) {
  const organization = context.org.id;
  const userWatches = await context.models.watch.getWatchedByUser(userId);

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
