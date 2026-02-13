import { Response } from "express";
import { parse, filter } from "scim2-parse-filter";
import { expandOrgMembers } from "back-end/src/services/organizations";
import {
  ScimListRequest,
  ScimListResponse,
  ScimUser,
} from "back-end/types/scim";
import { expandedMembertoScimUser } from "./getUser.js";

export const START_INDEX_DEFAULT = 0;
export const COUNT_DEFAULT = 20;

export async function listUsers(
  req: ScimListRequest,
  res: Response<ScimListResponse>,
) {
  const { startIndex, count, filter: filterQuery } = req.query;

  // startIndex queryParam is 1-based so we need to subtract 1
  const queryOptions = {
    startIndex: startIndex ? parseInt(startIndex) - 1 : START_INDEX_DEFAULT,
    count: count ? parseInt(count) : COUNT_DEFAULT,
  };

  const org = req.organization;

  const expandedMembers = await expandOrgMembers(org.members);

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

  // a startIndex less than 0 should be interpreted as 0
  const correctedStartIndex =
    queryOptions.startIndex < 0 ? 0 : queryOptions.startIndex;

  const resources = filteredUsers.slice(
    correctedStartIndex,
    correctedStartIndex + queryOptions.count,
  );

  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: filteredUsers.length,
    Resources: resources,
    startIndex: queryOptions.startIndex,
    itemsPerPage: queryOptions.count,
  });
}
