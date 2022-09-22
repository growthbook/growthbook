import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { createSavedGroup, updateSavedGroup } from "../models/SavedGroupModel";

// IMPORTANT: SavedGroups and Groups are very similar, but serve two different purposes. At the time of development 9/22 we are
// quietly deprecating Groups. Initially groups were used with experiments to only include people in a group in an experiement.
// SavedGroups are used with features flag rules where rules can say if "x is/is not in SavedGroup" do/don't show a feature

export async function postSavedGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  req.checkPermissions("createFeatures");

  const savedGroup = await createSavedGroup(groupList, {
    groupName,
    owner,
    attributeKey,
    orgId: org.id,
  });

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
}

export async function putSavedGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  req.checkPermissions("createFeatures");

  const savedGroup = await updateSavedGroup(groupList, groupName, {
    groupName,
    owner,
    attributeKey,
    orgId: org.id,
  });

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
}
