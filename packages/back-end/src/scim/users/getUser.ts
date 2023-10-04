import { Response } from "express";
import { ScimGetRequest } from "../../../types/scim";
import { getUserByExternalId } from "../../services/users";

export async function getUser(req: ScimGetRequest, res: Response) {
  const userId = req.params.id;

  const user = await getUserByExternalId(userId);

  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
    });
  }

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === user?.id);

  // TODO: I think we need to return the user object in this case, but with active set to false
  if (!orgUser) {
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
