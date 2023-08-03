import { AuditModel } from "../models/AuditModel";
import { getWatchesByUser } from "../models/WatchModel";
import { EntityType } from "../types/Audit";

export function isValidEntityType(type: string): type is EntityType {
  return EntityType.includes(type as EntityType);
}

export async function getWatchedAudits(userId: string, organization: string) {
  const userWatches = await getWatchesByUser(organization, userId);
  if (!userWatches) {
    return [];
  }
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7);

  const experiments = await AuditModel.find({
    organization,
    "entity.object": "experiment",
    "entity.id": {
      $in: userWatches.experiments,
    },
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
  });

  const features = await AuditModel.find({
    organization,
    "entity.object": "feature",
    "entity.id": {
      $in: userWatches.features,
    },
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
  });

  const all = experiments
    .concat(features)
    .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime());
  return all;
}

export function auditDetailsCreate<T>(
  post: T,
  context: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    post,
    context,
  });
}
export function auditDetailsUpdate<T>(
  pre: T,
  post: T,
  context: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    pre,
    post,
    context,
  });
}

export function auditDetailsDelete<T>(
  pre: T,
  context: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    pre,
    context,
  });
}
