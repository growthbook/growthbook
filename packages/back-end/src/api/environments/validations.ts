import { ApiReqContext } from "back-end/types/api";

export const validatePayload = async (
  context: ApiReqContext,
  {
    id,
    description = "",
    projects = [],
    toggleOnList = false,
    defaultState = false,
    parent,
  }: {
    id: string;
    description?: string;
    projects?: string[];
    toggleOnList?: boolean;
    defaultState?: boolean;
    parent?: string;
  },
) => {
  if (id === "") throw Error("Environment ID cannot empty!");

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

  if (parent && !context.hasPremiumFeature("environment-inheritance")) {
    throw new Error("Environment inheritance requires an enterprise license");
  }

  return { id, projects, description, toggleOnList, defaultState, parent };
};
