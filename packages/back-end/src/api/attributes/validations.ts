import { ApiReqContext } from "back-end/types/api";

export const validatePayload = async (
  context: ApiReqContext,
  {
    property,
    projects = [],
  }: {
    property: string;
    projects?: string[];
  },
) => {
  if (property === "") throw Error("Attribute property cannot empty!");

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

  return { property, projects };
};
