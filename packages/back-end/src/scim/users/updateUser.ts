import { Response } from "express";
import { getUserById, updateScimUserData } from "../../services/users";
import { ScimUserPutOrPostRequest } from "../../../types/scim";

export async function updateUser(
  req: ScimUserPutOrPostRequest,
  res: Response
): Promise<Response> {
  const user = await getUserById(req.params.id);

  const { name, userName, displayName } = req.body;

  if (!user) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User not found",
    });
  }

  try {
    // TODO: Explore if we should support updating external ID
    await updateScimUserData(user.id, {
      email: userName,
      name: displayName,
    });

    return res.status(200).json({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      id: user.id,
      externalId: user.externalId,
      userName,
      name: {
        formatted: name.formatted,
        givenName: name.givenName,
        familyName: name.familyName,
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
