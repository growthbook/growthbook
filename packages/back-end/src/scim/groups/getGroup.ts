import { Response } from "express";
import { findTeamById } from "../../models/TeamModel";
import { expandOrgMembers } from "../../services/organizations";
import { ScimError, ScimGetRequest, ScimGroup } from "../../../types/scim";
import { TeamInterface } from "../../../types/team";

export const teamtoScimGroup = (team: TeamInterface): ScimGroup => {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: team.id,
    displayName: team.name,
    members:
      team.members?.map((member) => {
        return { value: member.id, display: member.email };
      }) ?? [],
    meta: {
      resourceType: "Group",
    },
  };
};

export async function getGroup(
  req: ScimGetRequest,
  res: Response
): Promise<Response<ScimGroup | ScimError>> {
  console.log("getGroup endpoint was called");

  const { id } = req.params;

  const org = req.organization;

  const group = await findTeamById(id, org.id);

  if (!group) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Team ID does not exist",
      status: "404",
    });
  }

  const members = org.members.filter((member) => member.teams?.includes(id));
  const expandedMembers = await expandOrgMembers(members);

  return res
    .status(200)
    .json(teamtoScimGroup({ ...group, members: expandedMembers }));
}
