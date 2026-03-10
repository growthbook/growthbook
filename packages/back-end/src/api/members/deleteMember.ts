import { DeleteMemberResponse } from "shared/types/openapi";
import { deleteMemberValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { removeUserFromOrg } from "back-end/src/scim/users/patchUser";

export const deleteMember = createApiRequestHandler(deleteMemberValidator)(
  async (req): Promise<DeleteMemberResponse> => {
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

    try {
      await removeUserFromOrg(req.context.org, orgUser);

      await req.audit({
        event: "user.delete",
        entity: {
          object: "user",
          id: orgUser.id,
        },
      });
    } catch (e) {
      throw new Error(
        `Unable to remove ${req.params.id} from org: ${e.message}`,
      );
    }

    return {
      deletedId: req.params.id,
    };
  },
);
