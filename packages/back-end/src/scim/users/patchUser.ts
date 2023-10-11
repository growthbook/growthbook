import { cloneDeep } from "lodash";
import { Response } from "express";
import { updateOrganization } from "../../models/OrganizationModel";
import { getUserById } from "../../services/users";
import { ScimPatchRequest, ScimUser } from "../../../types/scim";
import { OrganizationInterface } from "../../../types/organization";

async function removeUserFromOrg(
  org: OrganizationInterface,
  userIndex: number
) {
  const updatedOrg = cloneDeep(org);

  // TODO: When we introduce the ability to manage roles via SCIM, we can remove this check.
  const userIsAdmin = org.members[userIndex].role === "admin";

  if (userIsAdmin) {
    const numberOfAdmins = org.members.filter(
      (member) => member.role === "admin"
    );

    if (numberOfAdmins.length === 1) {
      throw new Error("Cannot remove the only admin");
    }
  }

  updatedOrg.members.splice(userIndex, 1);

  await updateOrganization(org.id, updatedOrg);
}

export async function patchUser(req: ScimPatchRequest, res: Response) {
  // Get all of the params and operations
  const { Operations } = req.body;
  const org = req.organization;

  // Check if the user exists at all
  const user = await getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }

  if (!user.managedByIdp) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  // Check if the user exists within the org
  const userIndex = org.members.findIndex((member) => member.id === user.id);

  const updatedScimUser: ScimUser = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: req.params.id,
    displayName: user.name || "",
    userName: user.email,
    name: {
      formatted: user.name || "",
      givenName: user.name?.split(" ")[0] || "",
      familyName: user.name?.split(" ")[1] || "",
    },
    externalId: user.externalId,
    active: false, // Hard coded to false because we only support deactivation through PATCH currently
    emails: [
      {
        primary: true,
        value: user.email,
        type: "work",
        display: user.email,
      },
    ],
    groups: [],
    meta: {
      resourceType: "User",
    },
  };

  // Then, we need to loop through operations
  for (const operation of Operations) {
    const { op, value } = operation;
    // Okta will only ever use PATCH to active/deactivate a user or sync a user's password
    // https://developer.okta.com/docs/reference/scim/scim-20/#update-a-specific-user-patch
    if (op === "replace" && value.active === false) {
      // SCIM determines whether a user is active or not based on this property. If set to false, that means they want us to remove the user
      // this means they want us to remove the user
      try {
        await removeUserFromOrg(org, userIndex);
      } catch (e) {
        return res.status(400).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: "Cannot remove the only admin",
        });
      }
    } else if (op === "replace" && value.active === true) {
      // TODO: Add user back to org (self-hosted only. doing for cloud could leak user data)
    }
    // Silently ignore any operation to change a user's password
  }

  return res.status(200).json(updatedScimUser);
}
