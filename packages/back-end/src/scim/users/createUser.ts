import { Response } from "express";
import { cloneDeep } from "lodash";
import {
  addMemberToOrg,
  convertMemberToManagedByIdp,
  expandOrgMembers,
} from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";
import {
  ScimError,
  ScimUser,
  ScimUserPutOrPostRequest,
} from "../../../types/scim";
import {
  createUser as createNewUser,
  getUserByEmail,
} from "../../services/users";

export async function createUser(
  req: ScimUserPutOrPostRequest,
  res: Response<ScimUser | ScimError>
) {
  const { externalId, displayName, userName } = req.body;

  const org: OrganizationInterface = req.organization;

  const expandedMembers = await expandOrgMembers(org.members);
  const existingOrgMember = expandedMembers.find(
    (member) => member.email === userName
  );

  const role = org.settings?.defaultRole?.role || "readonly";
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
        newUser = await createNewUser(displayName, userName);
      }

      await addMemberToOrg({
        organization: org,
        userId: newUser.id,
        role,
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
        externalId,
        managedByIdp: true,
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
