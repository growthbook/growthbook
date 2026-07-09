import { ApiReqContext } from "back-end/types/api";

export async function validatePayload(
  context: ApiReqContext,
  {
    name,
    isPublic,
    description = "",
    attributes,
    projects = [],
    environments = [],
  }: {
    name: string;
    isPublic: boolean;
    description?: string;
    // eslint-disable-next-line
    attributes?: Record<string, any> | string; // Attributes from the payload will be an object but from an existing model will be a string
    projects?: string[];
    environments?: string[];
  },
) {
  if (name === "") throw Error("Archetype name cannot empty!");

  if (projects.length) {
    const allProjects = await context.models.projects.getAll();
    const nonexistentProjects = projects.filter(
      (p) => !allProjects.some(({ id }) => p === id),
    );

    if (nonexistentProjects.length)
      throw new Error(
        `The following projects do not exist: ${nonexistentProjects.join(", ")}`,
      );
  }

  if (environments.length) {
    const allEnvironments = context.org.settings?.environments || [];
    const nonexistentEnvironments = environments.filter(
      (e) => !allEnvironments.some(({ id }) => e === id),
    );

    if (nonexistentEnvironments.length)
      throw new Error(
        `The following environments do not exist: ${nonexistentEnvironments.join(", ")}`,
      );
  }

  if (typeof attributes !== "string") {
    attributes = JSON.stringify(attributes || {});
  }

  return {
    name,
    attributes,
    description,
    projects,
    environments,
    isPublic,
    owner: context.userId,
    organization: context.org.id,
  };
}
