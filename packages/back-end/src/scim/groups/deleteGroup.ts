import { Response } from "express";
import { ScimError, ScimGetRequest } from "back-end/types/scim";
import { deleteTeam, findTeamById } from "back-end/src/models/TeamModel";
import { removeMembersFromTeam } from "back-end/src/services/organizations";

export async function deleteGroup(
  req: ScimGetRequest,
  res: Response,
): Promise<Response<ScimError>> {
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

  try {
    await removeMembersFromTeam({
      organization: org,
      userIds: members.map((m) => m.id),
      teamId: id,
    });

    // Delete the team
    await deleteTeam(id, org.id);
  } catch (e) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to delete team from GrowthBook: ${e.message}`,
      status: "400",
    });
  }

  return res.status(204).json();
}
