import { cloneDeep } from "lodash";
import { Response } from "express";
import { Member, OrganizationInterface } from "shared/types/organization";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  ScimError,
  ScimOperation,
  ScimPatchRequest,
  ScimUser,
} from "back-end/types/scim";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { expandedMembertoScimUser } from "./getUser";

export async function removeUserFromOrg(
  org: OrganizationInterface,
  user: Member,
) {
  const updatedOrgMembers = cloneDeep(org.members);

  // If/When we introduce the ability to manage roles via SCIM, we can remove this check.
  const userIsAdmin = user.role === "admin";

  if (userIsAdmin) {
    const numberOfAdmins = org.members.filter(
      (member) => member.role === "admin",
    );

    if (numberOfAdmins.length === 1) {
      throw new Error("Cannot remove the only admin");
    }
  }

  const userIndex = org.members.findIndex((member) => member.id === user.id);
  updatedOrgMembers.splice(userIndex, 1);

  await updateOrganization(org.id, { members: updatedOrgMembers });
}

function parseActiveStatus(operation: ScimOperation): boolean | null {
  const { path, value } = operation;

  // Azure format: { op: "Replace", path: "active", value: false } - https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups?utm_source=chatgpt.com#request-14
  if (path?.toLowerCase() === "active") {
    return typeof value === "boolean" ? value : null;
  }

  // Okta format: { op: "replace", value: { active: false } } - https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/#update-a-specific-user-patch
  if (typeof value === "object" && value !== null && "active" in value) {
    return typeof value.active === "boolean" ? value.active : null;
  }

  return null; // No active status change in this operation
}

export async function patchUser(
  req: ScimPatchRequest,
  res: Response<ScimUser | ScimError>,
) {
  const { Operations } = req.body;
  const { id: userId } = req.params;
  const org = req.organization;

  // Find user in organization
  const orgUser = org.members.find((member) => member.id === userId);
  if (!orgUser) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
      status: "404",
    });
  }

  // Verify user is managed by IdP
  const expandedMember = await expandOrgMembers([orgUser]);
  if (!expandedMember[0].managedByIdp) {
    return res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  let shouldDeactivate = false;

  for (const operation of Operations) {
    const { op } = operation;

    if (op.toLowerCase() === "replace") {
      const activeStatus = parseActiveStatus(operation);

      if (activeStatus !== null) {
        shouldDeactivate = !activeStatus;
      }
    }
  }

  let userWasRemoved = false;
  if (shouldDeactivate) {
    try {
      await removeUserFromOrg(org, orgUser);
      userWasRemoved = true;
    } catch (e) {
      return res.status(400).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: `Unable to deactivate the user in GrowthBook: ${e.message}`,
      });
    }
  }

  const responseUser = expandedMembertoScimUser(
    expandedMember[0],
    !userWasRemoved,
  );

  return res.status(200).json(responseUser);
}
