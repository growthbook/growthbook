import { Request, Response } from "express";
import { ApiRequestLocals } from "../../../types/api";
import { getUserById, updateScimUserData } from "../../services/users";

export async function updateUser(
  req: Request & ApiRequestLocals,
  res: Response
): Promise<Response> {
  console.log("updateUser called", req.body);

  const user = await getUserById(req.params.id);

  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }

  try {
    await updateScimUserData(user.id, {
      email: req.body.userName,
      name: req.body.displayName,
    });

    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      externalId: user.externalId,
      userName: user.email,
      name: {
        displayName: user.name,
        givenName: req.body.name.givenName,
        familyName: req.body.name.familyName,
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
      detail: `Unable to update the user in GrowthBook: ${e.message}`,
      status: 500,
    });
  }
}
