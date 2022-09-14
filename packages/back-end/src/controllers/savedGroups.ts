import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { SavedGroupModel } from "../models/SavedGroupModel";

//IMPORTANT: SavedGroups and Groups are very similar, but serve two different purposes. At the time of development 9/22 we are
// quietly deprecating Groups. Initially groups were used with experiments to only include people in a group in an experiement
//SavedGroups are used with features flag rules where rules can say if "x is/is not in SavedGroup" do/don't show a feature

function formatGroup(list: string) {
  const listArr = list.split(",");

  const savedGroup = listArr.map((i: string) => {
    return i.trim();
  });

  return savedGroup;
}

export async function createSavedGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  const savedGroup = await SavedGroupModel.create({
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
    savedGroup,
  });
}

export async function updateSavedGroup(req: AuthRequest, res: Response) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  const savedGroup = await SavedGroupModel.updateOne(
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
    savedGroup,
  });
}
