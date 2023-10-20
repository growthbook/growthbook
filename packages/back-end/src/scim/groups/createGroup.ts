import { Response } from "express";
import { createTeam } from "../../models/TeamModel";
import {
  ScimError,
  ScimGroup,
  ScimGroupPostRequest,
} from "../../../types/scim";
import { addMemberToTeam } from "../../services/organizations";

export async function createGroup(
  req: ScimGroupPostRequest,
  res: Response
): Promise<Response<ScimGroup | ScimError>> {
  const { displayName, members } = req.body;

  const org = req.organization;

  const DEFAULT_TEAM_PERMISSIONS = {
    role: org.settings?.defaultRole?.role || "collaborator",
    limitAccessByEnvironment: false,
    environments: [],
  };

  try {
    const group = await createTeam({
      name: displayName,
      createdBy: "SCIM",
      description: "Created via SCIM.",
      organization: org.id,
      managedByIdp: true,
      ...DEFAULT_TEAM_PERMISSIONS,
    });

    await Promise.all(
      members.map((member) => {
        return addMemberToTeam({
          organization: org,
          userId: member.value,
          teamId: group.id,
        });
      })
    );

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
