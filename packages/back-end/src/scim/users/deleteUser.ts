import { Response } from "express";
import { ScimError, ScimGetRequest } from "back-end/types/scim";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { removeUserFromOrg } from "./patchUser";

export async function deleteUser(
  req: ScimGetRequest,
  res: Response,
): Promise<Response<ScimError>> {
  const { id: userId } = req.params;

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === userId);

  if (!orgUser) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
      status: "404",
    });
  }

  const expandedMember = await expandOrgMembers([orgUser]);

  if (!expandedMember[0].managedByIdp) {
    return res.status(401).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "401",
      detail: "This user isn't managed via an external IDP. Cannot update",
    });
  }

  try {
    await removeUserFromOrg(org, orgUser);
  } catch (e) {
    return res.status(400).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      detail: `Unable to deactivate the user in GrowthBook: ${e.message}`,
    });
  }

  return res.status(204).json();
}
