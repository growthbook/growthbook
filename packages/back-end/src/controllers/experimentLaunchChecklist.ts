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
  req: AuthRequest<{ tasks: ChecklistTask[] }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);

  const { tasks } = req.body;

  if (!org.members.some((member) => member.id === userId)) {
    return res.status(403).json({
      status: 403,
      message: "User is not a member of the organization",
    });
  }

  req.checkPermissions("organizationSettings");

  await createExperimentLaunchChecklist(org.id, userId, tasks);

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
  req: AuthRequest<{ tasks: ChecklistTask[] }, { id: string }>,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);
  const { tasks } = req.body;

  const { id } = req.params;

  if (!org.members.some((member) => member.id === userId)) {
    return res.status(403).json({
      status: 403,
      message: "User is not a member of the organization",
    });
  }

  req.checkPermissions("organizationSettings");

  await updateExperimentLaunchChecklist(org.id, userId, id, tasks);

  return res.status(200).json({
    status: 200,
  });
}

export async function putManualLaunchChecklist(
  req: AuthRequest<
    { checklist: { key: string; status: "complete" | "incomplete" }[] },
    { id: string }
  >,
  res: Response
) {
  const { org, userId } = getOrgFromReq(req);

  if (!org.members.some((member) => member.id === userId)) {
    return res.status(403).json({
      status: 403,
      message: "User is not a member of the organization",
    });
  }

  const { id } = req.params;
  const { checklist } = req.body;

  const experiment = await getExperimentById(org.id, id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];

  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  const updatedExperiment = cloneDeep(experiment);

  updatedExperiment.manualLaunchChecklist = checklist;

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
      checklist,
    }),
  });

  res.status(200).json({ status: 200 });
}
