import { Response } from "express";
import {
  BasicScimGroup,
  ScimError,
  ScimGroup,
  ScimGroupMember,
  ScimGroupPatchRequest,
} from "../../../types/scim";
import { findTeamById, updateTeamMetadata } from "../../models/TeamModel";
import {
  addMemberToTeam,
  removeMemberFromTeam,
} from "../../services/organizations";
import { Member } from "../../../types/organization";

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

  console.log({ Operations });

  for (const operation of Operations) {
    const { op, value, path } = operation;
    try {
      if (op === "remove") {
        // Remove requested members
        // UNIMPLEMENTED
        // TODO: parse filter within operation path (i.e. "members[value eq \"89bb1940-b905-4575-9e7f-6f887cfb368e\"]")
      } else if (op === "add" && path === "members") {
        // Add requested members
        await Promise.all(
          (value as ScimGroupMember[]).map((member) => {
            return addMemberToTeam({
              organization: org,
              userId: member.value,
              teamId: team.id,
            });
          })
        );
      } else if (op === "replace" && path === "members") {
        // Replace all team members with requested members
        if (value) {
          const prevMembers: Member[] = org.members.filter((member) =>
            member.teams?.includes(id)
          );
          await Promise.all(
            prevMembers.map((member) => {
              return removeMemberFromTeam({
                organization: org,
                userId: member.id,
                teamId: id,
              });
            })
          );
          await Promise.all(
            (value as ScimGroupMember[]).map((member) => {
              return addMemberToTeam({
                organization: org,
                userId: member.value,
                teamId: id,
              });
            })
          );
        }
      } else if (op === "replace" && !path) {
        // Update Group object
        await updateTeamMetadata(team.id, org.id, {
          ...team,
          name: (value as BasicScimGroup).displayName,
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

  return res.status(204);
}
