import { AuditModel } from "../models/AuditModel";
import { AuditInterface } from "../../types/audit";
import uniqid from "uniqid";
import { WatchModel } from "../models/WatchModel";
import { QueryOptions } from "mongoose";

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

export async function getWatchedAudits(userId: string, organization: string) {
  const doc = await WatchModel.findOne({
    userId,
    organization,
  });
  if (!doc) {
    return [];
  }

  const experiments = await AuditModel.find({
    organization,
    "entity.object": {
      $in: "experiment",
    },
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
      $gte: new Date(new Date().getTime() - 7 * 60 * 60 * 24 * 1000),
    },
  }).sort({
    dateCreated: -1,
  });

  const features = await AuditModel.find({
    organization,
    "entity.object": {
      $in: "feature",
    },
    "entity.id": {
      $in: doc.features,
    },
    event: {
      $in: ["feature.publish", "feature.update", "feature.toggle"],
    },
    dateCreated: {
      $gte: new Date(new Date().getTime() - 7 * 60 * 60 * 24 * 1000),
    },
  }).sort({
    dateCreated: -1,
  });

  const all = experiments.concat(features);
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
