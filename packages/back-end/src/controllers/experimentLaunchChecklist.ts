import { Response } from "express";
import { ExperimentInterface } from "shared/types/experiment";
import { ChecklistTask } from "shared/types/experimentLaunchChecklist";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { getContextFromReq } from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import {
  createExperimentLaunchChecklist,
  deleteExperimentLaunchChecklist,
  getExperimentLaunchChecklist,
  getExperimentLaunchChecklistById,
  updateExperimentLaunchChecklist,
} from "back-end/src/models/ExperimentLaunchChecklistModel";
import {
  getExperimentById,
  updateExperiment,
} from "back-end/src/models/ExperimentModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";

export async function postExperimentLaunchChecklist(
  req: AuthRequest<{ tasks: ChecklistTask[]; projectId?: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { tasks, projectId } = req.body;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    context.throwUnauthorizedError(
      "Must have a commercial License Key to customize the organization's pre-launch checklist.",
    );
  }

  if (!projectId) {
    // If no projectId is provided, the user is creating an organization-level checklist
    if (!context.permissions.canManageOrgSettings()) {
      context.permissions.throwPermissionError();
    }
  } else {
    // Ensure the projectId is a valid project
    const project = await context.models.projects.getById(projectId);
    if (!project) {
      throw new Error("Could not find project");
    }

    // If a projectId is provided, the user is creating a project-level checklist
    if (!context.permissions.canUpdateProject(projectId)) {
      context.permissions.throwPermissionError();
    }
  }

  const existingChecklist = await getExperimentLaunchChecklist(
    org.id,
    projectId || "",
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
    projectId || "",
  );

  return res.status(200).json({
    status: 200,
    checklist,
  });
}

// This is used to fetch the checklist for an experiment
export async function getExperimentCheckListByExperiment(
  req: AuthRequest<null, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    return res.status(200).json({
      status: 200,
      checklist: [],
    });
  }

  const experiment = await getExperimentById(context, id);

  if (!experiment) {
    return res.status(404).json({
      status: 404,
      message: "Experiment not found",
    });
  }

  // First, check if the experiment has a project, and if that project
  // has it's own checklist
  if (experiment.project) {
    const projectChecklist = await getExperimentLaunchChecklist(
      org.id,
      experiment.project,
    );

    if (projectChecklist) {
      return res.status(200).json({
        status: 200,
        checklist: projectChecklist,
      });
    }
  }

  // If no project-level checklist, fall back to the organization-level checklist
  const orgChecklist = await getExperimentLaunchChecklist(org.id, "");

  return res.status(200).json({
    status: 200,
    checklist: orgChecklist,
  });
}

// This is used to fetch the checklist for the org's settings page or the project's settings page
export async function getExperimentCheckList(
  req: AuthRequest<null, null, { projectId: string }>,
  res: Response,
) {
  const { org } = getContextFromReq(req);
  const { projectId } = req.query;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    return res.status(200).json({
      status: 200,
      checklist: [],
    });
  }

  const checklist = await getExperimentLaunchChecklist(org.id, projectId);

  return res.status(200).json({
    status: 200,
    checklist,
  });
}

export async function putExperimentLaunchChecklist(
  req: AuthRequest<{ tasks: ChecklistTask[] }, { id: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { org, userId } = context;
  const { tasks } = req.body;

  const { id } = req.params;

  if (!orgHasPremiumFeature(org, "custom-launch-checklist")) {
    context.throwUnauthorizedError(
      "Must have a commercial License Key to update a pre-launch checklist.",
    );
  }

  const checklist = await getExperimentLaunchChecklistById(org.id, id);

  if (!checklist) {
    return res.status(404).json({
      status: 404,
      message: "Could not find checklist",
    });
  }

  // If the checklist is an organization-level checklist, the user must have org settings permission
  if (!checklist.projectId) {
    if (!context.permissions.canManageOrgSettings()) {
      context.permissions.throwPermissionError();
    }
    // If the checklist is a project-level checklist, the user must have project permission
  } else {
    if (!context.permissions.canUpdateProject(checklist.projectId)) {
      context.permissions.throwPermissionError();
    }
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
  res: Response,
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

export async function deleteProjectScopedExperimentLaunchChecklist(
  req: AuthRequest<null, { checklistId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  const { checklistId } = req.params;

  const checklist = await getExperimentLaunchChecklistById(
    context.org.id,
    checklistId,
  );

  if (!checklist) {
    return res.status(404).json({
      status: 404,
      message: "Could not find checklist",
    });
  }

  if (!checklist.projectId) {
    return res.status(400).json({
      status: 400,
      message: "Cannot delete an organization-level checklist",
    });
  }

  // Ensure the user has permissions to update the project
  if (!context.permissions.canUpdateProject(checklist.projectId)) {
    context.permissions.throwPermissionError();
  }

  await deleteExperimentLaunchChecklist(context, checklist.id);

  return res.status(200).json({ status: 200 });
}
