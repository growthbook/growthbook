import { Response } from "express";
import { cloneDeep } from "lodash";
import { getAffectedEnvsForExperiment } from "shared/util";
import { getOrgFromReq } from "../services/organizations";
import { AuthRequest } from "../types/AuthRequest";
import {
  createExperimentLaunchChecklist,
  getExperimentLaunchChecklistByOrgIg,
  updateExperimentLaunchChecklist,
} from "../models/ExperimentLaunchChecklistModel";
import { ChecklistTask } from "../../types/experimentLaunchChecklist";
import { getExperimentById, updateExperiment } from "../models/ExperimentModel";
import { auditDetailsCreate } from "../services/audit";

export async function postExperimentLaunchChecklist(
  req: AuthRequest<{ checklist: ChecklistTask[] }>,
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

  const checklistObj = await getExperimentLaunchChecklistByOrgIg(org.id);

  return res.status(200).json({
    status: 200,
    checklistObj,
  });
}

export async function putExperimentLaunchChecklist(
  req: AuthRequest<{ checklist: ChecklistTask[]; id: string }>,
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

export async function putLaunchChecklist(
  req: AuthRequest<{ checklistKey: string; status: boolean }, { id: string }>,
  res: Response
) {
  const { org } = getOrgFromReq(req);

  const { id } = req.params;
  const { checklistKey, status } = req.body;

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];

  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  const updatedExperiment = cloneDeep(experiment);

  if (updatedExperiment.manualLaunchChecklist) {
    updatedExperiment.manualLaunchChecklist[checklistKey] = status;
  } else {
    updatedExperiment.manualLaunchChecklist = {
      [checklistKey]: status,
    };
  }

  await updateExperiment({
    organization: org,
    experiment,
    user: res.locals.eventAudit,
    changes: updatedExperiment,
  });

  await req.audit({
    event: "experiment.launchChecklist.updated",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsCreate({
      checklistKey,
      status,
    }),
  });

  res.status(200).json({ status: 200 });
}
