import uniqid from "uniqid";
import { QueryOptions } from "mongoose";
import { AuditModel } from "../models/AuditModel";
import { AuditInterface } from "../../types/audit";
import { WatchModel } from "../models/WatchModel";

export function insertAudit(data: Partial<AuditInterface>) {
  return AuditModel.create({
    ...data,
    id: uniqid("aud_"),
  });
}

export async function findByOrganization(
  organization: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      organization,
    },
    options
  );
}

export async function findByEntity(
  organization: string,
  type: string,
  id: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      organization,
      "entity.object": type,
      "entity.id": id,
    },
    options
  );
}

export async function findByEntityParent(
  organization: string,
  type: string,
  id: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      organization,
      "parent.object": type,
      "parent.id": id,
    },
    options
  );
}

export async function findAllByEntityType(
  organization: string,
  type: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      organization,
      "entity.object": type,
    },
    options
  );
}

export async function findAllByEntityTypeParent(
  organization: string,
  type: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      organization,
      "parent.object": type,
    },
    options
  );
}

export async function getWatchedAudits(userId: string, organization: string) {
  const doc = await WatchModel.findOne({
    userId,
    organization,
  });
  if (!doc) {
    return [];
  }
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7);

  const experiments = await AuditModel.find({
    organization,
    "entity.object": "experiment",
    "entity.id": {
      $in: doc.experiments,
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
      $in: doc.features,
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
