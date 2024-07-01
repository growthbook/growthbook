import { ApiReqContext } from "../../../types/api";

export const validatePayload = async (
  context: ApiReqContext,
  {
    id,
    description = "",
    projects = [],
    toggleOnList = false,
    defaultState = false,
  }: {
    id: string;
    description?: string;
    projects?: string[];
    toggleOnList?: boolean;
    defaultState?: boolean;
  }
) => {
  if (id === "") throw Error("Environment ID cannot empty!");

  if (projects.length) {
    const allProjects = await context.models.projects.getAll();
    const nonexistentProjects = projects.filter(
      (p) => !allProjects.some(({ id }) => p === id)
    );

    if (nonexistentProjects.length)
      throw new Error(
        `The following projects do not exist: ${nonexistentProjects.join(", ")}`
      );
  }

  return { id, projects, description, toggleOnList, defaultState };
};
