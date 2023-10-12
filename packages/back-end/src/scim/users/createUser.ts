import { Response } from "express";
import { cloneDeep } from "lodash";
import {
  addMemberToOrg,
  convertMemberToManagedByIdp,
  expandOrgMembers,
} from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";
import { ScimUserPutOrPostRequest } from "../../../types/scim";
import { createUser as createNewUser } from "../../services/users";

export async function createUser(req: ScimUserPutOrPostRequest, res: Response) {
  const { externalId, displayName, userName } = req.body;

  const org: OrganizationInterface = req.organization;

  const expandedMembers = await expandOrgMembers(org.members);
  const existingUser = expandedMembers.find(
    (member) => member.email === userName
  );

  const role = org.settings?.defaultRole?.role || "readonly";
  const responseObj = cloneDeep(req.body);

  try {
    if (existingUser && existingUser.managedByIdp) {
      // Return an error if user exists and they're managed by an external IDP
      return res.status(409).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        scimType: "uniqueness",
        detail: "User already exists in this organization",
        status: 409,
      });
    } else if (existingUser && !existingUser.managedByIdp) {
      // If created through GrowthBook, update the user with the externalId and managedByIdp: true
      await convertMemberToManagedByIdp({
        organization: org,
        userId: existingUser.id,
        externalId: externalId ? externalId : undefined,
      });

      responseObj.id = existingUser.id;
    } else {
      const newUser = await createNewUser(
        displayName,
        userName,
        "12345678", // TODO: SSO shouldn't need a password. figure out how to test this
        false
      );

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
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to create the new user in GrowthBook: ${e.message}`,
      status: 500,
    });
  }
}
