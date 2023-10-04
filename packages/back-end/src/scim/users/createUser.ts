import { Request, Response } from "express";
import {
  addExternalIdToExistingUser,
  createUser as createNewUser,
  getUserByEmail,
  getUserByExternalId,
} from "../../services/users";
import { addMemberToOrg } from "../../services/organizations";
import { OrganizationInterface } from "../../../types/organization";
import { ApiRequestLocals } from "../../../types/api";

export async function createUser(
  req: Request & ApiRequestLocals,
  res: Response
) {
  const requestBody = req.body.toString("utf-8");

  const requestBodyObject = JSON.parse(requestBody);

  const org: OrganizationInterface = req.organization;

  const role = org.settings?.defaultRole?.role || "readonly";

  try {
    // Look up the user in Mongo
    let user = await getUserByExternalId(requestBodyObject.externalId);

    // If the user already exists in the org, return an error
    if (user && org.members.find((member) => member.id === user?.id)) {
      return res.status(409).json({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        scimType: "uniqueness",
        detail: "User already exists in this organization",
        status: 409,
      });
    }

    if (!user) {
      // If we can't find the user by externalId, try to find them by email
      user = await getUserByEmail(requestBodyObject.userName);

      if (user && !user.externalId) {
        // if we find the user, but they don't have an externalId, add it - this happens when a user exists in GB, but now they're access is being managed by an external IDP
        await addExternalIdToExistingUser(
          user.id,
          requestBodyObject.externalId
        );
        user.externalId = requestBodyObject.externalId;
      }
    }

    if (!user) {
      // If we still can't find the user, create it
      user = await createNewUser(
        requestBodyObject.displayName,
        requestBodyObject.userName,
        requestBodyObject.password, // TODO: SSO shouldn't need a password. figure out how to test this
        requestBodyObject.externalId
      );
    }

    // check if the user already exists within the org
    const orgMember = org.members.find((member) => member.id === user?.id);

    if (!orgMember) {
      // If they aren't a part of the org, add them
      await addMemberToOrg({
        organization: org,
        userId: user.id,
        role,
        limitAccessByEnvironment: false,
        environments: [],
        projectRoles: [],
      });
    }

    return res.status(201).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.externalId,
      userName: user.email,
      name: {
        displayName: user.name,
        givenName: requestBodyObject.name.givenName,
        familyName: requestBodyObject.name.familyName,
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
      role: role,
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
