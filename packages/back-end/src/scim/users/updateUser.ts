import { Response } from "express";
import { cloneDeep } from "lodash";
import { updateOrganization } from "../../models/OrganizationModel";
import { getUserByExternalId, removeExternalId } from "../../services/users";
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

  // When we introduce the ability to manage roles via SCIM, we can remove this check.
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
  await removeExternalId(user.id);

  updatedScimUser.active = false;
}

export async function updateUser(req: ScimUpdateRequest, res: Response) {
  console.log("patchUser was called");
  console.log("req.organization", req.organization.id);
  console.log("req.params.id", req.params.id);

  // Get all of the params and operations
  const requestBody = req.body.toString("utf-8");
  const requestBodyObject = JSON.parse(requestBody);
  console.log("requestBodyObject", requestBodyObject);
  const org = req.organization;

  // Check if the user exists at all
  // After this is all said and done, we need to return the user object
  const user = await getUserByExternalId(req.params.id);
  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }
  // Check if the user exists within the org
  console.log("user", user);
  const userIndex = org.members.findIndex((member) => member.id === user.id);
  console.log("userIndex", userIndex);
  // if not, return a 404 error
  if (userIndex === -1) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }

  // Then, we need to loop through operations
  const operations: Operation[] = requestBodyObject.Operations;
  // TODO: Figure out how to handle this to satisfy all potential updates

  // Finally, we need to return the updated user object

  const updatedScimUser = {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: req.params.id,
    userName: user.email,
    name: {
      displayName: user.name || "",
    },
    active: userIndex > -1,
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
  for (const operation in operations) {
    const { op, value } = operations[operation];
    console.log("op", op);
    console.log("value:", value);

    // The only operation we support is making the user inactive
    if (op === "replace" && value.active === false) {
      // SCIM determines whether a user is active or not based on this property. If set to false, that means they want us to remove the user
      // this means they want us to remove the user
      console.log("remove user");
      try {
        await removeUserFromOrg(org, userIndex, user, updatedScimUser);
      } catch (e) {
        console.log("Error removing user from org", e);
        return res.status(400).json({
          schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
          status: "400",
          detail: "Cannot remove the only admin",
        });
      }
    }
    // otherwise, silently ignore the operation
  }

  console.log("about to return updatedScimUser", updatedScimUser);

  return res.status(200).json(updatedScimUser);
}
