import { Response } from "express";
import { ScimGetRequest } from "../../../types/scim";
import { getUserByExternalId, getUserById } from "../../services/users";

export async function getUser(req: ScimGetRequest, res: Response) {
  console.log("get User by ID endpoint hit");

  const userId = req.params.id;

  console.log("userId", userId);

  // Unclear if we even need externalId, at least for Okta. Okta doesn't seem to refer to externalId at all
  // in Runscope tests
  // const user = await getUserByExternalId(userId);
  const user = await getUserById(userId);

  console.log("user", user);

  if (!user) {
    console.log("about to return a user not found error");
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
    });
  }

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === user?.id);

  if (!orgUser) {
    console.log("about to return a user not in org error");
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User is not a part of the organization",
    });
  }

  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: req.params.id,
    userName: user.email,
    name: {
      displayName: user.name,
      givenName: user.name?.split(" ")[0],
      familyName: user.name?.split(" ")[1],
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
    role: orgUser.role,
    groups: [],
    meta: {
      resourceType: "User",
    },
  });
}
