import { isRoleValid } from "shared/permissions";
import { auditDetailsUpdate } from "@back-end/src/services/audit";
import { PutMemberRoleResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { putMemberRoleValidator } from "../../validators/openapi";
import { updateUserRole } from "../../scim/users/putUser";

export const putMemberRole = createApiRequestHandler(putMemberRoleValidator)(
  async (req): Promise<PutMemberRoleResponse> => {
    if (!req.context.permissions.canManageTeam()) {
      req.context.permissions.throwPermissionError();
    }

    const { globalRole } = req.body;

    if (!isRoleValid(globalRole, req.context.org)) {
      throw new Error(`${globalRole} is not a valid role`);
    }

    const orgUser = req.context.org.members.find(
      (member) => member.id === req.params.id
    );

    if (!orgUser) {
      throw new Error("Could not find user with that ID");
    }

    if (orgUser.role === globalRole) {
      return {
        globalRole,
      };
    }

    try {
      await updateUserRole(req.context.org, req.params.id, globalRole);

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
      globalRole,
    };
  }
);
