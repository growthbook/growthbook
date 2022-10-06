import { AuthRequest } from "../types/AuthRequest";
import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import {
  createSavedGroup,
  getSavedGroupById,
  parseSavedGroupString,
  updateSavedGroup,
} from "../models/SavedGroupModel";
import { auditDetailsCreate, auditDetailsUpdate } from "../services/audit";
import { savedGroupUpdated } from "../services/savedGroups";

// IMPORTANT: SavedGroups and Groups are very similar, but serve two different purposes. At the time of development 9/22 we are
// quietly deprecating Groups. Initially groups were used with experiments to only include people in a group in an experiement.
// SavedGroups are used with features flag rules where rules can say if "x is/is not in SavedGroup" do/don't show a feature

export async function postSavedGroup(
  req: AuthRequest<{
    groupName: string;
    owner: string;
    attributeKey: string;
    groupList: string;
  }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, attributeKey, groupList } = req.body;

  req.checkPermissions("createFeatures");

  const values = parseSavedGroupString(groupList);

  const savedGroup = await createSavedGroup({
    values,
    groupName,
    owner,
    attributeKey,
    organization: org.id,
  });

  await req.audit({
    event: "savedGroup.created",
    entity: {
      object: "savedGroup",
      id: savedGroup.id,
    },
    details: auditDetailsCreate(savedGroup),
  });

  return res.status(200).json({
    status: 200,
    savedGroup,
  });
}

export async function putSavedGroup(
  req: AuthRequest<
    {
      groupName: string;
      owner: string;
      attributeKey: string;
      groupList: string;
    },
    {
      id: string;
    }
  >,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { groupName, owner, groupList } = req.body;
  const { id } = req.params;

  if (!id) {
    throw new Error("Must specify saved group id");
  }

  req.checkPermissions("createFeatures");

  const savedGroup = await getSavedGroupById(id, org.id);

  if (!savedGroup) {
    throw new Error("Could not find saved group");
  }

  const values = parseSavedGroupString(groupList);

  const changes = await updateSavedGroup(id, org.id, {
    values,
    groupName,
    owner,
  });

  const updatedSavedGroup = { ...savedGroup, ...changes };

  await req.audit({
    event: "savedGroup.updated",
    entity: {
      object: "savedGroup",
      id: updatedSavedGroup.id,
    },
    details: auditDetailsUpdate(savedGroup, updatedSavedGroup),
  });

  // If the values change, we need to invalidate cached feature rules
  if (savedGroup.values !== values) {
    savedGroupUpdated(org);
  }

  return res.status(200).json({
    status: 200,
  });
}
