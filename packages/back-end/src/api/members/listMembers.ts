import { ListMembersResponse } from "shared/types/openapi";
import { listMembersValidator } from "shared/validators";
import { expandOrgMembers } from "back-end/src/services/organizations";
import {
  applyFilter,
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

export const listMembers = createApiRequestHandler(listMembersValidator)(async (
  req,
): Promise<ListMembersResponse> => {
  if (!req.context.permissions.canManageTeam()) {
    req.context.permissions.throwPermissionError();
  }

  const orgMembers = await expandOrgMembers(req.context.org.members);

  // TODO: Move sorting/limiting to the database query for better performance
  const { filtered, returnFields } = applyPagination(
    orgMembers
      .filter(
        (orgMember) =>
          applyFilter(req.query.userName, orgMember.name) &&
          applyFilter(req.query.userEmail, orgMember.email) &&
          applyFilter(req.query.globalRole, orgMember.role),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
    req.query,
  );

  return {
    members: filtered.map((member) => {
      return {
        id: member.id,
        name: member.name,
        email: member.email,
        globalRole: member.role,
        teams: member.teams,
        environments: member.environments,
        limitAccessByEnvironment: member.limitAccessByEnvironment,
        projectRoles: member.projectRoles,
        lastLoginDate: member.lastLoginDate?.toISOString(),
        dateCreated: member.dateCreated?.toISOString(),
        managedbyIdp: member.managedByIdp || false,
      };
    }),
    ...returnFields,
  };
});
