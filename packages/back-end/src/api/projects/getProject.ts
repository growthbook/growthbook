import { z } from "zod";
import { ApiProjectInterface } from "../../../types/api";
import { findProjectById } from "../../models/ProjectModel";
import { createApiRequestHandler } from "../../util/handler";

export const getProject = createApiRequestHandler({
  paramsSchema: z
    .object({
      id: z.string(),
    })
    .strict(),
})(
  async (req): Promise<{ project: ApiProjectInterface }> => {
    const project = await findProjectById(req.params.id, req.organization.id);
    if (!project) {
      throw new Error("Could not find project with that id");
    }

    return {
      project: {
        id: project.id,
        name: project.name,
        dateCreated: project.dateCreated.toISOString(),
        dateUpdated: project.dateUpdated.toISOString(),
      },
    };
  }
);
