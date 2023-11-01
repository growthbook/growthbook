import { Response } from "express";
import { getOrgFromReq } from "../services/organizations";
import { AuthRequest } from "../types/AuthRequest";
import {
  createExperimentLaunchChecklist,
  getExperimentLaunchChecklistByOrgIg,
  updateExperimentLaunchChecklist,
} from "../models/ExperimentLaunchChecklistModel";
import { ChecklistItem } from "../../types/experimentLaunchChecklist";

export async function postExperimentLaunchChecklist(
  req: AuthRequest<{ checklist: ChecklistItem[] }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const { checklist } = req.body;

  const userId = req.userId;

  if (!userId) {
    return res.status(403).json({
      status: 403,
      message: "User not found",
    });
  }

  // Confirm that the user is a member of the organization
  if (!org.members.some((member) => member.id === userId)) {
    return res.status(403).json({
      status: 403,
      message: "User is not a member of the organization",
    });
  }

  req.checkPermissions("organizationSettings");

  await createExperimentLaunchChecklist(org.id, userId, checklist);

  return res.status(201).json({});
}

export async function getExperimentCheckListByOrg(
  req: AuthRequest,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const checklist = await getExperimentLaunchChecklistByOrgIg(org.id);

  return res.status(200).json({
    status: 200,
    checklist,
  });
}

export async function putExperimentLaunchChecklist(
  req: AuthRequest<{ checklist: ChecklistItem[]; id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);
  const { id, checklist } = req.body;

  if (!id) {
    return res.status(400).json({
      status: 400,
      message: "Must provide checklist id",
    });
  }

  const userId = req.userId;

  if (!userId) {
    return res.status(403).json({
      status: 403,
      message: "User not found",
    });
  }

  // Confirm that the user is a member of the organization
  if (!org.members.some((member) => member.id === userId)) {
    return res.status(403).json({
      status: 403,
      message: "User is not a member of the organization",
    });
  }

  req.checkPermissions("organizationSettings");

  await updateExperimentLaunchChecklist(org.id, userId, id, checklist);

  return res.status(200).json({
    status: 200,
  });
}
