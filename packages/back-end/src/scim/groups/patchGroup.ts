import { Response } from "express";
import { parse, filter } from "scim2-parse-filter";
import { isRoleValid } from "shared/permissions";
import {
  BasicScimGroup,
  ScimError,
  ScimGroup,
  ScimGroupMember,
  ScimGroupPatchRequest,
} from "back-end/types/scim";
import {
  addMembersToTeam,
  expandOrgMembers,
  getMembersOfTeam,
  removeMembersFromTeam,
} from "back-end/src/services/organizations";

export async function patchGroup(
  req: ScimGroupPatchRequest,
  res: Response<ScimGroup | ScimError>,
) {
  const { Operations } = req.body;
  const { id } = req.params;

  const org = req.organization;

  const team = await req.context.models.teams.getById(id);

  if (!team) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Team ID does not exist",
      status: "404",
    });
  }

  for (const operation of Operations) {
    const { op, value, path } = operation;

    const normalizedOp = op.toLowerCase();
    const normalizedPath = path?.toLowerCase();

    try {
      if (normalizedOp === "remove") {
        // Remove requested members
        if (!normalizedPath) {
          return res.status(400).json({
            schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
            status: "400",
            detail: "Remove operation must include a path",
          });
        }

        // Maps each team member to a ScimGroupMember keyed with 'members' so that we can filter by the requested path
        // i.e. path: 'members[value eq "u_123abcdefg"]'
        const members: { members: ScimGroupMember }[] = (
          await expandOrgMembers(org.members)
        )
          .filter((member) => member.teams?.includes(team.id))
          .map((member) => {
            return { members: { value: member.id, display: member.email } };
          });

        const f = filter(parse(normalizedPath));
        const filtered = members.filter(f);

        await removeMembersFromTeam({
          organization: org,
          userIds: filtered.map((m) => m.members.value),
          teamId: team.id,
        });
      } else if (normalizedOp === "add" && normalizedPath === "members") {
        // Add requested members
        await addMembersToTeam({
          organization: org,
          userIds: (value as ScimGroupMember[]).map((m) => m.value),
          teamId: team.id,
        });
      } else if (normalizedOp === "replace" && normalizedPath === "members") {
        // Replace all team members with requested members
        if (value) {
          const prevMembers = getMembersOfTeam(org, id);
          await removeMembersFromTeam({
            organization: org,
            userIds: prevMembers,
            teamId: id,
          });

          await addMembersToTeam({
            organization: org,
            userIds: (value as ScimGroupMember[]).map((m) => m.value),
            teamId: id,
          });
        }
      } else if (normalizedOp === "replace" && !normalizedPath) {
        const role = (value as BasicScimGroup).growthbookRole;

        if (role && role !== team.role) {
          if (!isRoleValid(role, org)) {
            return res.status(400).json({
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "400",
              detail: `"${role}" is not a valid GrowthBook role.`,
            });
          }
        }
        await req.context.models.teams.update(team, {
          ...team,
          name: (value as BasicScimGroup).displayName,
          managedByIdp: true,
          role,
        });
      } else {
        return res.status(400).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: "Unsupported operation",
        });
      }
    } catch (e) {
      return res.status(400).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: `Unable to perform ${op} operation`,
      });
    }
  }

  return res.status(204).json();
}
