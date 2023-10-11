import { Response } from "express";
import { parse, filter } from "scim2-parse-filter";
import { expandOrgMembers } from "../../services/organizations";
import { ScimListRequest, ScimUser } from "../../../types/scim";
import { ExpandedMember } from "../../../types/organization";

export const START_INDEX_DEFAULT = 1;
export const COUNT_DEFAULT = 20;

const expandedMembertoScimUser = (
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

export async function listUsers(req: ScimListRequest, res: Response) {
  const { startIndex, count, filter: filterQuery } = req.query;

  const queryOptions = {
    startIndex: startIndex ? parseInt(startIndex) : START_INDEX_DEFAULT,
    count: count ? parseInt(count) : COUNT_DEFAULT,
  };

  const org = req.organization;

  const expandedMembers = await expandOrgMembers(org.members);
  const expandedRemovedMembers = org.removedMembers
    ? await expandOrgMembers(org.removedMembers)
    : [];

  // TODO: return inactive users too for self-hosted to adhere to SCIM (users not in the org)
  const reduced = expandedMembers.reduce((filtered: ScimUser[], user) => {
    if (user.managedByIdp) {
      const scimUser: ScimUser = expandedMembertoScimUser(user);

      filtered.push(scimUser);
    }
    return filtered;
  }, []);

  const filteredUsers = filterQuery
    ? reduced.filter(filter(parse(filterQuery)))
    : reduced;

  // change startIndex to be 1-based. if less than 1, make it 1
  const resources = filteredUsers.slice(
    queryOptions.startIndex - 1,
    queryOptions.startIndex - 1 + queryOptions.count
  );

  // TODO: figure out a max for itemsPerPage. if count > max we will return max # of resources
  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: filteredUsers.length,
    Resources: resources,
    startIndex: queryOptions.startIndex,
    itemsPerPage: queryOptions.count,
  });
}
