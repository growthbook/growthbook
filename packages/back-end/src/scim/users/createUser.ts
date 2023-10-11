import { Response } from "express";
import { cloneDeep } from "lodash";
import {
  convertUserToManagedByIdp,
  createUser as createNewUser,
  getUserByEmail,
} from "../../services/users";
import { addMemberToOrg } from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";
import { ScimUserPutOrPostRequest } from "../../../types/scim";

export async function createUser(req: ScimUserPutOrPostRequest, res: Response) {
  const { externalId, displayName, userName } = req.body;

  const org: OrganizationInterface = req.organization;

  const role = org.settings?.defaultRole?.role || "readonly";

  try {
    // Look up the user in Mongo
    let user = await getUserByEmail(userName);

    if (user && org.members.find((member) => member.id === user?.id)) {
      // Check if they're managed by an external IDP
      if (user.managedByIdp) {
        // If so, return an error
        return res.status(409).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          scimType: "uniqueness",
          detail: "User already exists in this organization",
          status: 409,
        });
      } else {
        // otherwise, update the user with the externalId and managedByIdp: true
        await convertUserToManagedByIdp(
          user.id,
          externalId ? externalId : undefined
        );
      }
    }

    if (!user) {
      // If we still can't find the user, create it
      user = await createNewUser(
        displayName,
        userName,
        "12345678", // TODO: SSO shouldn't need a password. figure out how to test this
        false,
        true,
        externalId ? externalId : undefined
      );
    }

    await addMemberToOrg({
      organization: org,
      userId: user.id,
      role,
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
    });

    const responseObj = cloneDeep(req.body);

    responseObj.id = user.id;

    return res.status(201).json(responseObj);
  } catch (e) {
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to create the new user in GrowthBook: ${e.message}`,
      status: 500,
    });
  }
}
