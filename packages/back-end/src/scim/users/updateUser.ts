import { Response } from "express";
import { cloneDeep } from "lodash";
import { updateOrganization } from "../../models/OrganizationModel";
import { getUserByExternalId } from "../../services/users";
import { ScimUpdateRequest } from "../../../types/scim";
import { OrganizationInterface } from "../../../types/organization";

type Operation = {
  op: "add" | "remove" | "replace";
  path: string; // Path is optional for add & replace, and required for remove operations
  value: {
    [key: string]: unknown;
  };
};

async function removeUserFromOrg(
  org: OrganizationInterface,
  userIndex: number
) {
  const updatedOrg = cloneDeep(org);

  updatedOrg.members.splice(userIndex, 1);

  await updateOrganization(org.id, updatedOrg);
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

  for (const operation in operations) {
    const { op, value } = operations[operation];
    console.log("op", op);
    console.log("value:", value);

    switch (op) {
      case "replace":
        console.log("replace");
        if (value.active === false) {
          // this means they want us to remove the user
          console.log("remove user");
          await removeUserFromOrg(org, userIndex);
          // TODO: Build a function to handle this
        }
        break;
      case "add":
        console.log("add");
        break;
      case "remove":
        console.log("remove");
        await removeUserFromOrg(org, userIndex);
        break;
    }

    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: requestBodyObject.externalId,
      userName: user.email,
      name: {
        displayName: user.name,
      },
      active: false, // This should be true if they are in the org.members array
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
  }
}
