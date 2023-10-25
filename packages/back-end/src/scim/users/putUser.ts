import { cloneDeep } from "lodash";
import { Response } from "express";
import { ScimError, ScimUser, ScimUserPutRequest } from "../../../types/scim";
import { expandOrgMembers } from "../../services/organizations";
import { updateOrganization } from "../../models/OrganizationModel";
import { MemberRole, OrganizationInterface } from "../../../types/organization";

async function updateUserRole(
  org: OrganizationInterface,
  userId: string,
  newRole: MemberRole
) {
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

  if (expandedMember[0].name !== req.body.displayName) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Cannot update displayName",
    });
  }

  if (expandedMember[0].email !== req.body.userName) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: "Cannot update userName",
    });
  }

  const responseObj = cloneDeep(req.body);

  if (
    req.body.growthbookRole &&
    req.body.growthbookRole !== expandedMember[0].role
  ) {
    try {
      await updateUserRole(org, userId, req.body.growthbookRole);
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
