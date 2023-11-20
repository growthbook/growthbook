import { cloneDeep } from "lodash";
import { Response } from "express";
import { ScimError, ScimUser, ScimUserPutRequest } from "../../../types/scim";
import { expandOrgMembers } from "../../services/organizations";
import { updateOrganization } from "../../models/OrganizationModel";
import { MemberRole, OrganizationInterface } from "../../../types/organization";
import { isRoleValid } from "./createUser";

async function updateUserRole(
  org: OrganizationInterface,
  userId: string,
  newRole: MemberRole
) {
  const orgUser = org.members.find((member) => member.id === userId);

  if (!orgUser) {
    throw new Error("User does not exist in this organization");
  }
  const updatedOrgMembers = cloneDeep(org.members);

  const userIndex = org.members.findIndex((member) => member.id === userId);

  updatedOrgMembers[userIndex].role = newRole;

  await updateOrganization(org.id, { members: updatedOrgMembers });
}

export async function putUser(
  req: ScimUserPutRequest,
  res: Response<ScimUser | ScimError>
) {
  const userId = req.params.id;

  const { displayName, userName, growthbookRole } = req.body;

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === userId);

  if (!orgUser) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
      status: "404",
    });
  }

  const expandedMembers = await expandOrgMembers([orgUser]);

  const {
    name: currentMemberName,
    email: currentMemberEmail,
    managedByIdp: currentMemberManagedByIdp,
    role: currentMemberRole,
  } = expandedMembers[0];

  if (!currentMemberManagedByIdp) {
    return res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  if (currentMemberName !== displayName) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Cannot update displayName",
    });
  }

  if (currentMemberEmail !== userName) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Cannot update userName",
    });
  }

  const responseObj = cloneDeep(req.body);

  if (growthbookRole && growthbookRole !== currentMemberRole) {
    if (!isRoleValid(growthbookRole)) {
      return res.status(400).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: `"${growthbookRole}" is not a valid GrowthBook role.`,
      });
    }
    try {
      await updateUserRole(org, userId, growthbookRole);
    } catch (e) {
      return res.status(400).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "400",
        detail: `Unable to update the user's role: ${e.message}`,
      });
    }
  }

  return res.status(200).json(responseObj);
}
