import { Request, Response } from "express";
import {
  createUser as createNewUser,
  getUserByEmail,
} from "../../services/users";
import { addMemberToOrg } from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";
import { ApiRequestLocals } from "../../../types/api";

export async function createUser(
  req: Request & ApiRequestLocals,
  res: Response
) {
  const requestBody = req.body;

  console.log({ requestBody });

  const org: OrganizationInterface = req.organization;

  const role = org.settings?.defaultRole?.role || "readonly";

  try {
    // Look up the user in Mongo
    let user = await getUserByEmail(requestBody.userName);

    // If the user already exists in the org, return an error
    if (user && org.members.find((member) => member.id === user?.id)) {
      return res.status(409).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        scimType: "uniqueness",
        detail: "User already exists in this organization",
        status: 409,
      });
    }

    // If we find the user by externalId, we should check that the email and the name match, and if not, update them
    // if (user && user.email !== requestBody.userName) {
    //   await updateScimUserData(user.id, {
    //     email: requestBody.userName,
    //     name: requestBody.displayName,
    //   });

    //   user.email = requestBody.userName;
    //   user.name = requestBody.displayName;
    // }

    // if (!user) {
    //   // If we can't find the user by externalId, try to find them by email
    //   user = await getUserByEmail(requestBody.userName);

    //   if (user && !user.externalId) {
    //     // if we find the user, but they don't have an externalId, add it - this happens when a user exists in GB, but now they're access is being managed by an external IDP
    //     await addExternalIdToExistingUser(user.id, requestBody.externalId);
    //     user.externalId = requestBody.externalId;
    //   }
    // }

    if (!user) {
      // If we still can't find the user, create it
      user = await createNewUser(
        requestBody.displayName,
        requestBody.userName,
        "12345678", // TODO: SSO shouldn't need a password. figure out how to test this
        false, // TODO: Double check this logic
        true,
        requestBody.externalId ? requestBody.externalId : undefined
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

    return res.status(201).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      externalId: user.externalId,
      userName: user.email,
      name: {
        displayName: user.name,
        givenName: requestBody.name.givenName,
        familyName: requestBody.name.familyName,
      },
      active: true,
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
    });
  } catch (e) {
    return res.status(500).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: `Unable to create the new user in GrowthBook: ${e.message}`,
      status: 500,
    });
  }
}
