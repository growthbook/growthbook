import { isRoleValid, roleSupportsEnvLimit } from "shared/permissions";
import { cloneDeep } from "lodash";
import { updateOrganization } from "../../models/OrganizationModel";
import { auditDetailsUpdate } from "../../services/audit";
import { UpdateMemberRoleResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { updateMemberRoleValidator } from "../../validators/openapi";
import { Member } from "../../../types/organization";

export const updateMemberRole = createApiRequestHandler(
  updateMemberRoleValidator
)(
  async (req): Promise<UpdateMemberRoleResponse> => {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }

    const { globalRole, environments } = req.body;

    // validate the role
    if (globalRole) {
      if (!isRoleValid(globalRole, req.context.org)) {
        throw new Error(`${globalRole} is not a valid role`);
      }
    }
    //MKTODO: Block updating if this user is being managed externally via an IDP

    // validate the environments
    if (environments?.length) {
      environments.forEach((env) => {
        const environmentIds =
          req.context.org.settings?.environments?.map((e) => e.id) || [];
        if (!environmentIds.includes(env)) {
          throw new Error(
            `${env} is not a valid environment ID for this organization.`
          );
        }
      });
    }

    const orgUser = req.context.org.members.find(
      (member) => member.id === req.params.id
    );

    if (!orgUser) {
      throw new Error("Could not find user with that ID");
    }

    const updates: Member = { ...orgUser, role: globalRole || orgUser.role };

    // update envs if new role supports it and envs are passed in
    if (roleSupportsEnvLimit(updates.role, req.context.org) && !!environments) {
      updates.environments = environments;
      updates.limitAccessByEnvironment = !!environments.length;
    }

    // if role doesn't support envs, ensure we update it accordingly
    if (!roleSupportsEnvLimit(updates.role, req.context.org)) {
      updates.environments = [];
      updates.limitAccessByEnvironment = false;
    }

    try {
      const updatedOrgMembers = cloneDeep(req.context.org.members);

      const userIndex = req.context.org.members.findIndex(
        (member) => member.id === req.params.id
      );

      if (userIndex === -1) {
        throw new Error("User not found in organization");
      }

      updatedOrgMembers[userIndex] = updates;

      await updateOrganization(req.context.org.id, {
        members: updatedOrgMembers,
      });

      await req.audit({
        event: "user.update",
        entity: {
          object: "user",
          id: orgUser.id,
        },
        details: auditDetailsUpdate(orgUser, { ...orgUser, role: globalRole }),
      });
    } catch (e) {
      throw new Error(`Unable to update the user's role: ${e.message}`);
    }

    return {
      globalRole: updates.role,
      environments: updates.environments,
      limitAccessByEnvironment: updates.limitAccessByEnvironment,
    };
  }
);
