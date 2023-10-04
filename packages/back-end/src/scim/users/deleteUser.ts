import { Response } from "express";
import { updateOrganization } from "../../models/OrganizationModel";
import { ScimGetRequest } from "../../../types/scim";

export async function deleteUser(req: ScimGetRequest, res: Response) {
  const requestBody = req.body.toString("utf-8");

  const requestBodyObject = JSON.parse(requestBody);

  const org = req.organization;

  const requestToRemoveUser =
    requestBodyObject.Operations[0].value.active === false;

  if (!requestToRemoveUser) {
    // throw error that this isn't supported or return something
  }

  // Look up the user in the org's member list
  const userIndex = org.members.findIndex(
    (member) => member.id === req.params.id
  );

  const updatedOrg = org;

  updatedOrg.members.splice(userIndex, 1);

  await updateOrganization(org.id, updatedOrg);

  return res.status(204);
}
