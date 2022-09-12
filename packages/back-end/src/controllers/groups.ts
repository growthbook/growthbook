import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { GroupModel } from "../models/GroupModel";

export async function getAllGroups(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);

  const doc = await GroupModel.find({
    organization: org.id,
  });
  if (doc) {
    return res.status(200).json({
      status: 200,
      groupsArr: doc,
    });
  }

  return [];
}

export async function createGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, csv } = req.body;

  const group = await GroupModel.create({
    groupName,
    owner,
    attributeKey,
    csv,
    organization: org.id,
    dateCreated: Date.now(),
    dateUpdated: Date.now(),
  });

  return res.status(200).json({
    status: 200,
    group,
  });
}

export async function updateGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, csv } = req.body;

  const group = await GroupModel.updateOne(
    { groupName: groupName },
    {
      groupName,
      owner,
      attributeKey,
      csv,
      organization: org.id,
      dateUpdated: Date.now(),
    }
  );

  return res.status(200).json({
    status: 200,
    group,
  });
}
