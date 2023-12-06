import { Response } from "express";
import { parse, filter } from "scim2-parse-filter";
import { cloneDeep } from "lodash";
import {
  BasicScimGroup,
  ScimError,
  ScimGroup,
  ScimGroupMember,
  ScimGroupPatchRequest,
} from "../../../types/scim";
import { findTeamById, updateTeamMetadata } from "../../models/TeamModel";
import {
  addMembersToTeam,
  expandOrgMembers,
  removeMembersFromTeam,
} from "../../services/organizations";
import { Member } from "../../../types/organization";
import { isRoleValid } from "../users/createUser";

export async function patchGroup(
  req: ScimGroupPatchRequest,
  res: Response<ScimGroup | ScimError>
) {
  const { Operations } = req.body;
  const { id } = req.params;

  const org = req.organization;

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "Team ID does not exist",
      status: "404",
    });
  }

  for (const operation of Operations) {
    const { op, value, path } = operation;

    try {
      if (op === "remove") {
        // Remove requested members
        if (!path) {
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

        const f = filter(parse(path));
        const filtered = members.filter(f);

        await removeMembersFromTeam({
          organization: org,
          userIds: filtered.map((m) => m.members.value),
          teamId: team.id,
        });
      } else if (op === "add" && path === "members") {
        // Add requested members
        await addMembersToTeam({
          organization: org,
          userIds: (value as ScimGroupMember[]).map((m) => m.value),
          teamId: team.id,
        });
      } else if (op === "replace" && path === "members") {
        // Replace all team members with requested members
        if (value) {
          const prevMembers: Member[] = org.members.filter((member) =>
            member.teams?.includes(id)
          );
          await removeMembersFromTeam({
            organization: org,
            userIds: prevMembers.map((m) => m.id),
            teamId: id,
          });

          await addMembersToTeam({
            organization: org,
            userIds: (value as ScimGroupMember[]).map((m) => m.value),
            teamId: id,
          });
        }
      } else if (op === "replace" && !path) {
        // Update Group object
        const updatedTeam = cloneDeep(team);

        updatedTeam.name = (value as BasicScimGroup).displayName;
        updatedTeam.managedByIdp = true;

        const growthbookRole = (value as BasicScimGroup).growthbookRole;

        if (growthbookRole && growthbookRole !== team.role) {
          if (!isRoleValid(growthbookRole)) {
            return res.status(400).json({
              schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
              status: "400",
              detail: `"${growthbookRole}" is not a valid GrowthBook role.`,
            });
          }

          updatedTeam.role = growthbookRole;
        }

        await updateTeamMetadata(team.id, org.id, updatedTeam);
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
