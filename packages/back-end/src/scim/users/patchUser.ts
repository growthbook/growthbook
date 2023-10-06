import { Response } from "express";
import { cloneDeep } from "lodash";
import { updateOrganization } from "../../models/OrganizationModel";
import {
  getUserByExternalId,
  getUserById,
  removeExternalId,
} from "../../services/users";
import { ScimUpdateRequest } from "../../../types/scim";
import { OrganizationInterface } from "../../../types/organization";
import { UserInterface } from "../../../types/user";

type Operation = {
  op: "add" | "remove" | "replace";
  path: string; // Path is optional for add & replace, and required for remove operations
  value: {
    [key: string]: unknown;
  };
};

type ScimEmailObject = {
  primary: boolean;
  value: string;
  type: string;
  display: string;
};

type ScimUserObject = {
  schemas: string[];
  id: string;
  userName: string;
  name: {
    displayName: string;
  };
  active: boolean;
  emails: ScimEmailObject[];
  groups: string[];
  meta: {
    resourceType: string;
  };
};

async function removeUserFromOrg(
  org: OrganizationInterface,
  userIndex: number,
  user: UserInterface,
  updatedScimUser: ScimUserObject
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

  updatedScimUser.active = false;
}

export async function patchUser(req: ScimUpdateRequest, res: Response) {
  // Get all of the params and operations
  const requestBody = req.body;
  const org = req.organization;

  // Check if the user exists at all
  // After this is all said and done, we need to return the user object
  const user = await getUserById(req.params.id);
  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }

  if (!user.externalId || !user.managedByIdp) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  // Check if the user exists within the org
  const userIndex = org.members.findIndex((member) => member.id === user.id);

  // Then, we need to loop through operations
  const operations: Operation[] = requestBody.Operations;

  const updatedScimUser = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: req.params.id,
    userName: user.email,
    name: {
      displayName: user.name || "",
      givenName: user.name?.split(" ")[0],
      familyName: user.name?.split(" ")[1],
    },
    externalId: user.externalId,
    active: userIndex > -1, // If a user has an externalId but is not in the org they're inactive
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
  for (const operation of operations) {
    const { op, value } = operation;
    // Okta will only ever use PATCH to active/deactivate a user or sync a user's password
    // https://developer.okta.com/docs/reference/scim/scim-20/#update-a-specific-user-patch
    if (op === "replace" && value.active === false) {
      // SCIM determines whether a user is active or not based on this property. If set to false, that means they want us to remove the user
      // this means they want us to remove the user
      try {
        await removeUserFromOrg(org, userIndex, user, updatedScimUser);
      } catch (e) {
        return res.status(400).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: "Cannot remove the only admin",
        });
      }
    } else if (op === "replace" && value.active === true) {
      // TODO: Add user to org
    }
    // Silently ignore any operation to change a user's password
  }

  return res.status(200).json(updatedScimUser);
}
