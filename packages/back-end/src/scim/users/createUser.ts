import { Response } from "express";
import { cloneDeep } from "lodash";
import { getDefaultRole, isRoleValid } from "shared/permissions";
import { OrganizationInterface } from "shared/types/organization";
import {
  addMemberToOrg,
  convertMemberToManagedByIdp,
  expandOrgMembers,
} from "back-end/src/services/organizations";
import { ScimError, ScimUser, ScimUserPostRequest } from "back-end/types/scim";
import {
  createUser as createNewUser,
  getUserByEmail,
} from "back-end/src/models/UserModel";

export async function createUser(
  req: ScimUserPostRequest,
  res: Response<ScimUser | ScimError>,
) {
  const { externalId, displayName, userName, growthbookRole } = req.body;

  const org: OrganizationInterface = req.organization;

  let roleInfo = getDefaultRole(org);

  if (growthbookRole && isRoleValid(growthbookRole, org)) {
    // If a growthbookRole is provided, use that
    roleInfo = {
      role: growthbookRole,
      limitAccessByEnvironment: false,
      environments: [],
    };
  }

  const expandedMembers = await expandOrgMembers(org.members);
  const existingOrgMember = expandedMembers.find(
    (member) => member.email === userName,
  );

  const responseObj = cloneDeep(req.body);

  try {
    if (existingOrgMember && existingOrgMember.managedByIdp) {
      // Return an error if user exists and they're managed by an external IDP
      return res.status(409).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        scimType: "uniqueness",
        detail: "User already exists in this organization",
        status: "409",
      });
    } else if (existingOrgMember && !existingOrgMember.managedByIdp) {
      // If created through GrowthBook, update the user with the externalId and managedByIdp: true
      await convertMemberToManagedByIdp({
        organization: org,
        userId: existingOrgMember.id,
        externalId: externalId ? externalId : undefined,
      });

      responseObj.id = existingOrgMember.id;
    } else {
      let newUser = await getUserByEmail(userName);

      if (!newUser) {
        newUser = await createNewUser({ name: displayName, email: userName });
      }

      await addMemberToOrg({
        organization: org,
        userId: newUser.id,
        projectRoles: [],
        externalId,
        managedByIdp: true,
        ...roleInfo,
      });

      responseObj.id = newUser.id;
    }

    return res.status(201).json(responseObj);
  } catch (e) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to create the new user in GrowthBook: ${e.message}`,
      status: "400",
    });
  }
}
