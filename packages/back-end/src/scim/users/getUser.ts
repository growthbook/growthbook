import { Response } from "express";
import { ScimGetRequest } from "../../../types/scim";
import { getUserById } from "../../services/users";

export async function getUser(req: ScimGetRequest, res: Response) {
  const userId = req.params.id;

  const user = await getUserById(userId);

  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
    });
  }

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === user?.id);

  // TODO: Create a function to map Growthbook users to SCIM users that we can use here and in listUsers
  if (!orgUser) {
    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: req.params.id,
      userName: user.email,
      name: {
        displayName: user.name,
        givenName: user.name?.split(" ")[0],
        familyName: user.name?.split(" ")[1],
      },
      active: false,
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
    groups: [],
    meta: {
      resourceType: "User",
    },
  });
}
