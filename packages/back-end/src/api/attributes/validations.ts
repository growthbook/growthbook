import { SDKAttributeType } from "shared/types/organization";
import { ApiReqContext } from "back-end/types/api";

export const validatePayload = async (
  context: ApiReqContext,
  {
    property,
    datatype,
    enum: enumValue,
    projects = [],
  }: {
    property: string;
    datatype?: SDKAttributeType;
    enum?: string;
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

  // Allowed values ("enum") only apply to the enum datatype and array datatypes,
  // where they constrain a list attribute to a fixed set. Clear them for any
  // other datatype, mirroring the attribute editor UI.
  const enumApplies =
    datatype === "enum" || (!!datatype && datatype.endsWith("[]"));

  return {
    property,
    projects,
    ...(enumValue && !enumApplies ? { enum: "" } : {}),
  };
};
