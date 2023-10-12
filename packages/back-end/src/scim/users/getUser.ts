import { Response } from "express";
import { ScimGetRequest, ScimUser } from "../../../types/scim";
import { ExpandedMember } from "../../../types/organization";
import { expandOrgMembers } from "../../services/organizations";

export const expandedMembertoScimUser = (
  member: ExpandedMember,
  active: boolean = true
): ScimUser => {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: member.id,
    displayName: member.name,
    externalId: member.externalId,
    userName: member.email,
    name: {
      formatted: member.name,
      givenName: member.name.split(" ")[0],
      familyName: member.name.split(" ")[1],
    },
    active,
    emails: [
      {
        primary: true,
        value: member.email,
        type: "work",
        display: member.email,
      },
    ],
    groups: [], // TODO: figure out groups object shape and include groups
    meta: {
      resourceType: "User",
    },
  };
};

export async function getUser(req: ScimGetRequest, res: Response) {
  const userId = req.params.id;

  const org = req.organization;

  const orgUser = org.members.find((member) => member.id === userId);

  if (!orgUser) {
    return res.status(404).json({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      detail: "User ID does not exist",
    });
  }

  const expandedMember = await expandOrgMembers([orgUser]);

  return res.status(200).json(expandedMembertoScimUser(expandedMember[0]));
}
