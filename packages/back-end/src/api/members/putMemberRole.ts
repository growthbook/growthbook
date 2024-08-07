import { isRoleValid, roleSupportsEnvLimit } from "shared/permissions";
import { cloneDeep } from "lodash";
import { updateOrganization } from "../../models/OrganizationModel";
import { auditDetailsUpdate } from "../../services/audit";
import { PutMemberRoleResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { putMemberRoleValidator } from "../../validators/openapi";
import { Member } from "../../../types/organization";

export const putMemberRole = createApiRequestHandler(putMemberRoleValidator)(
  async (req): Promise<PutMemberRoleResponse> => {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }

    const { globalRole, environments } = req.body;

    if (!isRoleValid(globalRole, req.context.org)) {
      throw new Error(`${globalRole} is not a valid role`);
    }

    const orgUser = req.context.org.members.find(
      (member) => member.id === req.params.id
    );

    if (!orgUser) {
      throw new Error("Could not find user with that ID");
    }

    const updates: Member = { ...orgUser, role: globalRole };

    //TODO: Rethink this
    // Now, handle env limit stuff
    let updatedEnvs: string[] = [];
    let updatedLimitAccessByEnv = false;

    // Check if the globalRole supports env limits
    if (
      roleSupportsEnvLimit(globalRole, req.context.org) &&
      environments?.length
    ) {
      updatedEnvs = environments;
      updatedLimitAccessByEnv = true;
    }

    updates.environments = updatedEnvs;
    updates.limitAccessByEnvironment = updatedLimitAccessByEnv;

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
