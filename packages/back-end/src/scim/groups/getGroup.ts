import { Response } from "express";
import { TeamInterface } from "shared/types/team";
import { ExpandedMember } from "shared/types/organization";
import { findTeamById } from "back-end/src/models/TeamModel";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { ScimError, ScimGetRequest, ScimGroup } from "back-end/types/scim";

type TeamWithMembers = Omit<TeamInterface, "members"> & {
  members: ExpandedMember[];
};

export const teamtoScimGroup = (team: TeamWithMembers): ScimGroup => {
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
  res: Response,
): Promise<Response<ScimGroup | ScimError>> {
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

  if (!group.managedByIdp) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail:
        "Team is currently managed by GrowthBook. Please link to a group in your idP to use SCIM.",
      status: "400",
    });
  }

  const members = org.members.filter((member) => member.teams?.includes(id));
  const expandedMembers = await expandOrgMembers(members);

  return res
    .status(200)
    .json(teamtoScimGroup({ ...group, members: expandedMembers }));
}
