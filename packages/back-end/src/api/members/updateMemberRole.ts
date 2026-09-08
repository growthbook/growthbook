import { cloneDeep } from "lodash";
import { updateMemberRoleValidator } from "shared/validators";
import { Member, ProjectMemberRole } from "shared/types/organization";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  assertMemberRoleInfoValid,
  assertRoleChangeAllowed,
} from "back-end/src/services/organizations";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";

// The API takes each extra rule's environment list as its limit.
const normalizeExtraRules = (
  roles: { role: string; environments: string[] }[] | undefined,
) =>
  roles?.map((extra) => ({
    ...extra,
    limitAccessByEnvironment: !!extra.environments.length,
  }));

export const updateMemberRole = createApiRequestHandler(
  updateMemberRoleValidator,
)(async (req) => {
  if (!req.context.permissions.canManageTeam()) {
    req.context.permissions.throwPermissionError();
  }

  const orgUser = req.context.org.members.find(
    (member) => member.id === req.params.id,
  );

  if (!orgUser) {
    throw new Error("Could not find user with that ID");
  }

  if (orgUser.managedByIdp) {
    throw new Error(
      "This user is managed via an External Identity Provider (IDP) via SCIM 2.0 - User can only be updated via the IDP",
    );
  }

  const { member } = req.body;

  const updatedMember: Member = {
    ...orgUser,
    role: member.role || orgUser.role,
    environments: member.environments || orgUser.environments,
    limitAccessByEnvironment: !!member.environments?.length,
    additionalRoles:
      normalizeExtraRules(member.additionalRoles) ?? orgUser.additionalRoles,
  };

  if (member.projectRoles?.length) {
    const updatedProjectRoles: ProjectMemberRole[] = member.projectRoles.map(
      (projectRole) => ({
        ...projectRole,
        limitAccessByEnvironment: !!projectRole.environments.length,
        additionalRoles: normalizeExtraRules(projectRole.additionalRoles),
      }),
    );
    updatedMember.projectRoles = updatedProjectRoles;
  }

  // if an empty projectRoles array was passed in, the org is removing all projectRoles for this user
  if ("projectRoles" in member && !member.projectRoles?.length) {
    updatedMember.projectRoles = [];
  }

  // Only gate a role change so existing assignments keep working
  assertRoleChangeAllowed(req.context.org, orgUser.role, updatedMember.role);

  // Same validation every member-role writer runs, internal or REST.
  assertMemberRoleInfoValid(req.context.org, updatedMember);

  try {
    const updatedOrgMembers = cloneDeep(req.context.org.members);

    const userIndex = req.context.org.members.findIndex(
      (member) => member.id === req.params.id,
    );

    if (userIndex === -1) {
      throw new Error("User not found in organization");
    }

    updatedOrgMembers[userIndex] = updatedMember;

    //TODO: This is susceptible to race conditions if multiple requests are made for two different users at the same time
    await updateOrganization(req.context.org.id, {
      members: updatedOrgMembers,
    });

    await req.audit({
      event: "user.update",
      entity: {
        object: "user",
        id: orgUser.id,
      },
      details: auditDetailsUpdate(orgUser, updatedMember),
    });
  } catch (e) {
    throw new Error(`Unable to update the user's role: ${e.message}`);
  }

  return {
    updatedMember: {
      id: req.params.id,
      role: updatedMember.role,
      environments: updatedMember.environments,
      limitAccessByEnvironment: updatedMember.limitAccessByEnvironment,
      additionalRoles: updatedMember.additionalRoles,
      projectRoles: updatedMember.projectRoles,
    },
  };
});
