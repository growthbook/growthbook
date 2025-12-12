import { isRoleValid, roleSupportsEnvLimit } from "shared/permissions";
import { cloneDeep } from "lodash";
import { UpdateMemberRoleResponse } from "shared/types/openapi";
import { updateMemberRoleValidator } from "shared/validators";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  Member,
  OrganizationInterface,
  ProjectMemberRole,
} from "back-end/types/organization";

export function validateRoleAndEnvs(
  org: OrganizationInterface,
  role: string,
  limitAccessByEnvironment: boolean,
  environments?: string[],
): { memberIsValid: boolean; reason: string } {
  try {
    if (!isRoleValid(role, org)) {
      throw new Error(`${role}) is not a valid role`);
    }

    if (role === "noaccess" && !orgHasPremiumFeature(org, "no-access-role")) {
      throw new Error(
        "Must have a commercial License Key to gain access to the no-access role.",
      );
    }

    if (limitAccessByEnvironment) {
      if (environments?.length) {
        if (!orgHasPremiumFeature(org, "advanced-permissions")) {
          throw new Error(
            "Must have a commercial License Key to restrict permissions by environment.",
          );
        }

        if (!roleSupportsEnvLimit(role, org)) {
          throw new Error(
            `${role} does not support restricting access to certain environments.`,
          );
        }

        environments.forEach((env) => {
          const environmentIds =
            org.settings?.environments?.map((e) => e.id) || [];
          if (!environmentIds.includes(env)) {
            throw new Error(
              `${env} is not a valid environment ID for this organization.`,
            );
          }
        });
      }
    }
  } catch (e) {
    return {
      memberIsValid: false,
      reason: e.message || "Role information is not valid",
    };
  }

  return {
    memberIsValid: true,
    reason: "",
  };
}

export const updateMemberRole = createApiRequestHandler(
  updateMemberRoleValidator,
)(async (req): Promise<UpdateMemberRoleResponse> => {
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
  };

  // First, check the global role data
  const { memberIsValid, reason } = validateRoleAndEnvs(
    req.context.org,
    updatedMember.role,
    updatedMember.limitAccessByEnvironment,
    updatedMember.environments,
  );

  if (!memberIsValid) {
    throw new Error(reason);
  }

  // Then, if member.projectRoles was passed in, we need to validate the each projectRole
  if (member.projectRoles?.length) {
    if (!orgHasPremiumFeature(req.context.org, "advanced-permissions")) {
      throw new Error(
        "Your plan does not support providing users with project-level permissions.",
      );
    }
    const updatedProjectRoles: ProjectMemberRole[] = [];
    member.projectRoles.forEach((updatedProjectRole) => {
      const { memberIsValid, reason } = validateRoleAndEnvs(
        req.context.org,
        updatedProjectRole.role,
        updatedProjectRole.limitAccessByEnvironment || false,
        updatedProjectRole.environments,
      );

      if (!memberIsValid) {
        throw new Error(reason);
      }

      updatedProjectRoles.push({
        ...updatedProjectRole,
        limitAccessByEnvironment: !!updatedProjectRole.environments.length,
      });
    });

    updatedMember.projectRoles = updatedProjectRoles;
  }

  // if an empty projectRoles array was passed in, the org is removing all projectRoles for this user
  if ("projectRoles" in member && !member.projectRoles?.length) {
    updatedMember.projectRoles = [];
  }

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
      projectRoles: updatedMember.projectRoles,
    },
  };
});
