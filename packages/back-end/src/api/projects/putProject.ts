import { PutProjectResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { putProjectValidator } from "../../validators/openapi";
import { auditDetailsUpdate } from "../../services/audit";
import { ProjectModel } from "../../models/ProjectModel";

export const putProject = createApiRequestHandler(putProjectValidator)(
  async (req): Promise<PutProjectResponse> => {
    const project = await req.context.models.projects.getById(req.params.id);
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    const newProject = await req.context.models.projects.update(
      project,
      ProjectModel.updateValidator.parse(req.body)
    );

    await req.audit({
      event: "project.update",
      entity: {
        object: "project",
        id: project.id,
      },
      details: auditDetailsUpdate(project, newProject),
    });

    return {
      project: req.context.models.projects.toApiInterface(newProject),
    };
  }
);
