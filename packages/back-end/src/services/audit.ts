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

export async function getWatchedAudits(
  userId: string,
  organization: string,
  options?: QueryOptions
) {
  const doc = await WatchModel.findOne({
    userId,
    organization,
  });
  if (!doc) {
    return [];
  }

  const allWatchedThings = doc.experiments.concat(doc.features);

  return AuditModel.find({
    organization,
    "entity.object": {
      $in: ["experiment", "feature"],
    },
    "entity.id": {
      $in: allWatchedThings,
    },
    event: {
      $in: [
        "experiment.start",
        "experiment.stop",
        "experiment.phase",
        "experiment.results",
        "feature.publish",
        "feature.update",
        "feature.toggle",
      ],
    },
  })
    .sort({
      dateCreated: -1,
    })
    .limit(options?.limit || 50);
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
