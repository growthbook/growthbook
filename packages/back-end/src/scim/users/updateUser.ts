import { Response } from "express";
import { updateOrganization } from "../../models/OrganizationModel";
import { getUserByExternalId } from "../../services/users";
import { ScimUpdateRequest } from "../../../types/scim";

export async function updateUser(req: ScimUpdateRequest, res: Response) {
  console.log("patchUser was called");

  const requestBody = req.body.toString("utf-8");

  const requestBodyObject = JSON.parse(requestBody);
  console.log("requestBodyObject", requestBodyObject);

  const org = req.organization;

  console.log("req.organization", req.organization.id);

  console.log("req.params.id", req.params.id);

  if (!org) {
    // Return an error in the shape SCIM is expecting
  }

  const requestToRemoveUser =
    requestBodyObject.Operations[0].value.active === false;

  if (!requestToRemoveUser) {
    // throw error that this isn't supported or return something
  }

  // Look up the user in the org's member list
  const userIndex = org.members.findIndex(
    (member) => member.id === req.params.id
  );

  const role = org.members[userIndex].role;

  const updatedOrg = org;

  updatedOrg.members.splice(userIndex, 1);

  await updateOrganization(org.id, updatedOrg);

  const user = await getUserByExternalId(req.params.id);

  if (!user) {
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
    id: requestBodyObject.externalId,
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
    role, //TODO: I'm not sure this is needed
    groups: [],
    meta: {
      resourceType: "User",
    },
  });
}
