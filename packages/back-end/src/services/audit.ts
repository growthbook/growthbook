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
  type: string,
  id: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      "entity.object": type,
      "entity.id": id,
    },
    options
  );
}

export async function findByEntityParent(
  type: string,
  id: string,
  options?: QueryOptions
) {
  return AuditModel.find(
    {
      "parent.object": type,
      "parent.id": id,
    },
    options
  );
}

export async function findByUserId(userId: string, options?: QueryOptions) {
  return AuditModel.find(
    {
      "user.id": userId,
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

  return AuditModel.find({
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
  })
    .sort({
      dateCreated: -1,
    })
    .limit(options.limit || 50);
}
