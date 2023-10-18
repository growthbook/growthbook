import { Response } from "express";
import { createTeam } from "../../models/TeamModel";
import {
  ScimError,
  ScimGroup,
  ScimGroupPostRequest,
} from "../../../types/scim";
import { addMemberToTeam } from "../../services/organizations";

const DEFAULT_TEAM_PERMISSIONS = {
  role: "collaborator",
  limitAccessByEnvironment: false,
  environments: [],
};

export async function createGroup(
  req: ScimGroupPostRequest,
  res: Response
): Promise<Response<ScimGroup | ScimError>> {
  console.log("createGroup endpoint was called");

  const { displayName, members } = req.body;

  const org = req.organization;

  try {
    const group = await createTeam({
      name: displayName,
      createdBy: "SCIM",
      description: "Created via SCIM.",
      organization: org.id,
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
