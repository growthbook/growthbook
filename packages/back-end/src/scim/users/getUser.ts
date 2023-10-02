import { Response } from "express";
import { ScimGetRequest } from "../../../types/scim";
import { getUserByExternalId } from "../../services/users";

export async function getUser(req: ScimGetRequest, res: Response) {
  console.log("get User by ID endpoint hit");

  const userId = req.params.id;

  console.log("userId", userId);

  const user = await getUserByExternalId(userId);

  console.log("user", user);

  if (!user) {
    console.log("about to return an empty list");
    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      Resources: [],
      startIndex: 1,
      itemsPerPage: 20,
    });
  }

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === user?.id);

  if (!orgUser) {
    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      Resources: [],
      startIndex: 1,
      itemsPerPage: 20,
    });
  }

  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: req.params.id,
    userName: user.email,
    name: {
      displayName: user.name,
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
