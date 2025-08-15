import { Response } from "express";
import { isRoleValid, getDefaultRole } from "shared/permissions";
import { createTeam } from "back-end/src/models/TeamModel";
import {
  ScimError,
  ScimGroup,
  ScimGroupPostRequest,
} from "back-end/types/scim";
import { addMembersToTeam } from "back-end/src/services/organizations";

export async function createGroup(
  req: ScimGroupPostRequest,
  res: Response,
): Promise<Response<ScimGroup | ScimError>> {
  const { displayName, members, growthbookRole } = req.body;

  const org = req.organization;

  let roleInfo = getDefaultRole(org);

  if (growthbookRole && isRoleValid(growthbookRole, org)) {
    roleInfo = {
      role: growthbookRole,
      limitAccessByEnvironment: false,
      environments: [],
    };
  }

  try {
    const group = await createTeam({
      name: displayName,
      createdBy: "SCIM",
      description: "Created via SCIM.",
      organization: org.id,
      managedByIdp: true,
      ...roleInfo,
    });

    await addMembersToTeam({
      organization: org,
      userIds: members.map((m) => m.value),
      teamId: group.id,
    });

    return res.status(201).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      displayName: group.name,
      members,
      meta: {
        resourceType: "Group",
      },
    });
  } catch (e) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to create the new team in GrowthBook: ${e.message}`,
      status: "400",
    });
  }
}
