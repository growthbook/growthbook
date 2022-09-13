import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { GroupModel } from "../models/GroupModel";

function formatGroup(list: string) {
  const listArr = list.split(",");

  const group = listArr.map((i: string) => {
    return i.trim();
  });

  return group;
}

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
  const { groupName, owner, attributeKey, groupList } = req.body;

  const group = await GroupModel.create({
    groupName,
    owner,
    attributeKey,
    group: formatGroup(groupList),
    organization: org.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  return res.status(200).json({
    status: 200,
    group,
  });
}

export async function updateGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  const group = await GroupModel.updateOne(
    { groupName: groupName },
    {
      groupName,
      owner,
      attributeKey,
      group: formatGroup(groupList),
      organization: org.id,
      dateUpdated: new Date(),
    }
  );

  return res.status(200).json({
    status: 200,
    group,
  });
}
