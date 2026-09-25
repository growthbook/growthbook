import {
  deleteLaunchChecklistValidator,
  getLaunchChecklistValidator,
  putLaunchChecklistValidator,
} from "shared/validators";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import {
  createExperimentLaunchChecklist,
  deleteExperimentLaunchChecklist,
  getExperimentLaunchChecklist,
  updateExperimentLaunchChecklist,
} from "back-end/src/models/ExperimentLaunchChecklistModel";
import { NotFoundError } from "back-end/src/util/errors";
import { ApiReqContext } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiLaunchChecklist(c: ExperimentLaunchChecklistInterface) {
  return {
    id: c.id,
    projectId: c.projectId,
    tasks: c.tasks,
    dateCreated: c.dateCreated.toISOString(),
    dateUpdated: c.dateUpdated.toISOString(),
  };
}

// Same rules as the settings pages that edit these checklists.
async function assertCanEditChecklist(context: ApiReqContext, projectId = "") {
  if (!context.hasPremiumFeature("custom-launch-checklist")) {
    context.throwPlanDoesNotAllowError(
      "Your plan does not support customizing the pre-launch checklist.",
    );
  }
  if (!projectId) {
    if (!context.permissions.canManageOrgSettings()) {
      context.permissions.throwPermissionError();
    }
    return;
  }
  if (!(await context.models.projects.getById(projectId))) {
    throw new NotFoundError(`Could not find project: ${projectId}`);
  }
  if (!context.permissions.canUpdateProject(projectId)) {
    context.permissions.throwPermissionError();
  }
}

export const getLaunchChecklist = createApiRequestHandler(
  getLaunchChecklistValidator,
)(async (req) => {
  const checklist = req.context.hasPremiumFeature("custom-launch-checklist")
    ? await getExperimentLaunchChecklist(
        req.context.org.id,
        req.query.projectId ?? "",
      )
    : null;
  return {
    launchChecklist: checklist ? toApiLaunchChecklist(checklist) : null,
  };
});

export const putLaunchChecklist = createApiRequestHandler(
  putLaunchChecklistValidator,
)(async (req) => {
  const { context } = req;
  const projectId = req.query.projectId ?? "";
  await assertCanEditChecklist(context, projectId);

  const userId = context.userId || "";
  const existing = await getExperimentLaunchChecklist(
    context.org.id,
    projectId,
  );
  if (existing) {
    await updateExperimentLaunchChecklist(
      context.org.id,
      userId,
      existing.id,
      req.body.tasks,
    );
  } else {
    await createExperimentLaunchChecklist(
      context.org.id,
      userId,
      req.body.tasks,
      projectId,
    );
  }

  const saved = await getExperimentLaunchChecklist(context.org.id, projectId);
  if (!saved) throw new Error("Failed to save the checklist");
  return { launchChecklist: toApiLaunchChecklist(saved) };
});

export const deleteLaunchChecklist = createApiRequestHandler(
  deleteLaunchChecklistValidator,
)(async (req) => {
  const { context } = req;
  const { projectId } = req.query;
  await assertCanEditChecklist(context, projectId);
  const checklist = await getExperimentLaunchChecklist(
    context.org.id,
    projectId,
  );
  if (!checklist) {
    throw new NotFoundError(`No checklist for project: ${projectId}`);
  }
  await deleteExperimentLaunchChecklist(context, checklist.id);
  return { deletedId: checklist.id };
});
