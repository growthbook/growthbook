import { ListMembersResponse } from "../../../types/openapi";
import { expandOrgMembers } from "../../services/organizations";
import { applyPagination, createApiRequestHandler } from "../../util/handler";
import { listMembersValidator } from "../../validators/openapi";

export const listMembers = createApiRequestHandler(listMembersValidator)(
  async (req): Promise<ListMembersResponse> => {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }

    const orgMembers = await expandOrgMembers(req.context.org.members);

    const { returnFields } = applyPagination(orgMembers, req.query);

    return {
      members: orgMembers.map((member) => {
        return {
          id: member.id,
          name: member.name,
          email: member.email,
          globalRole: member.role,
          teams: member.teams,
          environments: member.environments,
          projectRoles: member.projectRoles,
          lastLoginDate: member.lastLoginDate?.toISOString(),
          dateCreated: member.dateCreated?.toISOString(),
        };
      }),
      ...returnFields,
    };
  }
);
