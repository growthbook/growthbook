import { expandOrgMembers } from "../../services/organizations";
import { GetMemberResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { getMemberValidator } from "../../validators/openapi";

export const getMember = createApiRequestHandler(getMemberValidator)(
  async (req): Promise<GetMemberResponse> => {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }

    const orgUser = req.context.org.members.find(
      (member) => member.id === req.params.id
    );

    if (!orgUser) {
      throw new Error("Could not find user with that ID");
    }

    const expandedMembers = await expandOrgMembers([orgUser]);

    if (!expandedMembers) {
      throw new Error("Could not find user with that ID");
    }

    return {
      member: {
        id: expandedMembers[0].id,
        name: expandedMembers[0].name,
        email: expandedMembers[0].email,
        globalRole: expandedMembers[0].role,
        teams: expandedMembers[0].teams,
        environments: expandedMembers[0].environments,
        projectRoles: expandedMembers[0].projectRoles,
        lastLoginDate: expandedMembers[0].lastLoginDate?.toISOString(),
        dateCreated: expandedMembers[0].dateCreated?.toISOString(),
      },
    };
  }
);
