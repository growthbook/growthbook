import { Response } from "express";
import { ExpandedMember } from "shared/types/organization";
import { ScimError, ScimGetRequest, ScimUser } from "back-end/types/scim";
import { expandOrgMembers } from "back-end/src/services/organizations";

export const expandedMembertoScimUser = (
  member: ExpandedMember,
  active: boolean = true,
): ScimUser => {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: member.id,
    userName: member.email,
    displayName: member.name,
    active,
    externalId: member.externalId,
  };
};

export async function getUser(
  req: ScimGetRequest,
  res: Response<ScimUser | ScimError>,
) {
  const userId = req.params.id;

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

  return res.status(200).json(expandedMembertoScimUser(expandedMember[0]));
}
