import { Response } from "express";
import { orgHasPremiumFeature } from "enterprise";
import { ExperimentInterface } from "back-end/types/experiment";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  createExperimentLaunchChecklist,
  getExperimentLaunchChecklist,
  getExperimentLaunchChecklistById,
  updateExperimentLaunchChecklist,
} from "back-end/src/models/ExperimentLaunchChecklistModel";
import { ChecklistTask } from "back-end/types/experimentLaunchChecklist";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export async function postExperimentLaunchChecklist(
  req: AuthRequest<{ tasks: ChecklistTask[]; projectId?: string }>,
  res: Response
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }
  const { org, userId } = context;

  const { tasks, projectId } = req.body;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    throw new Error(
      "Must have a commercial License Key to customize the organization's pre-launch checklist."
    );
  }

  const existingChecklist = await getExperimentLaunchChecklist(
    org.id,
    projectId || ""
  );

  if (existingChecklist) {
    return res.status(400).json({
      status: 400,
      message: `A checklist already exists for this ${
        projectId ? "project" : "organization"
      }"}`,
    });
  }

  const checklist = await createExperimentLaunchChecklist(
    org.id,
    userId,
    tasks,
    projectId || ""
  );

  return res.status(200).json({
    status: 200,
    checklist,
  });
}

export async function getExperimentCheckListByOrg(
  req: AuthRequest,
  res: Response
) {
  const { org } = getContextFromReq(req);

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    return res.status(200).json({
      status: 200,
      checklist: [],
    });
  }

  const checklist = await getExperimentLaunchChecklist(org.id, "");

  return res.status(200).json({
    status: 200,
    checklist,
  });
}

//TODO: Add getExperimentCheckListByProject method

export async function putExperimentLaunchChecklist(
  req: AuthRequest<{ tasks: ChecklistTask[] }, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }
  const { org, userId } = context;
  const { tasks } = req.body;

  const { id } = req.params;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    throw new Error(
      "Must have a commercial License Key to update the organization's pre-launch checklist."
    );
  }

  const checklist = await getExperimentLaunchChecklistById(org.id, id);

  if (!checklist) {
    return res.status(404).json({
      status: 404,
      message: "Could not find checklist",
    });
  }

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
  const context = getContextFromReq(req);

  const { id } = req.params;
  const { checklist } = req.body;

  const changes: Partial<ExperimentInterface> = {
    manualLaunchChecklist: checklist,
  };

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  if (!context.permissions.canUpdateExperiment(experiment, changes)) {
    context.permissions.throwPermissionError();
  }

  await updateExperiment({
    context,
    experiment,
    changes,
  });

  await req.audit({
    event: "experiment.launchChecklist.updated",
    entity: {
      object: "experiment",
      id: experiment.id,
    },
    details: auditDetailsUpdate(experiment.manualLaunchChecklist, checklist),
  });

  res.status(200).json({ status: 200 });
}
