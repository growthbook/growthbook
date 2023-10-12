import { cloneDeep } from "lodash";
import { Response } from "express";
import { updateOrganization } from "../../models/OrganizationModel";
import { ScimError, ScimPatchRequest, ScimUser } from "../../../types/scim";
import { Member, OrganizationInterface } from "../../../types/organization";
import { expandOrgMembers } from "../../services/organizations";
import { expandedMembertoScimUser } from "./getUser";

async function removeUserFromOrg(org: OrganizationInterface, user: Member) {
  const updatedOrgMembers = cloneDeep(org.members);

  // If/When we introduce the ability to manage roles via SCIM, we can remove this check.
  const userIsAdmin = user.role === "admin";

  if (userIsAdmin) {
    const numberOfAdmins = org.members.filter(
      (member) => member.role === "admin"
    );

    if (numberOfAdmins.length === 1) {
      throw new Error("Cannot remove the only admin");
    }
  }

  const userIndex = org.members.findIndex((member) => member.id === user.id);

  updatedOrgMembers.splice(userIndex, 1);

  await updateOrganization(org.id, { members: updatedOrgMembers });
}

export async function patchUser(
  req: ScimPatchRequest,
  res: Response<ScimUser | ScimError>
) {
  const { Operations } = req.body;
  const { id: userId } = req.params;

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === userId);

  if (!orgUser) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
      status: "404",
    });
  }

  const expandedMember = await expandOrgMembers([orgUser]);

  if (!expandedMember[0].managedByIdp) {
    return res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  const updatedScimUser: ScimUser = expandedMembertoScimUser(
    expandedMember[0],
    false
  );

  for (const operation of Operations) {
    const { op, value } = operation;
    // Okta will only ever use PATCH to active/deactivate a user or sync a user's password
    // https://developer.okta.com/docs/reference/scim/scim-20/#update-a-specific-user-patch
    if (op === "replace" && value.active === false) {
      // SCIM determines whether a user is active or not based on this property. If set to false, that means they want us to remove the user
      // this means they want us to remove the user
      try {
        await removeUserFromOrg(org, orgUser);
      } catch (e) {
        return res.status(400).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: `Unable to deactivate the user in GrowthBook: ${e.message}`,
        });
      }
    }
  }

  return res.status(200).json(updatedScimUser);
}
