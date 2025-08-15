import { parse, filter } from "scim2-parse-filter";
import { Response } from "express";
import { getTeamsForOrganization } from "back-end/src/models/TeamModel";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { ScimListRequest, ScimListResponse } from "back-end/types/scim";
import {
  COUNT_DEFAULT,
  START_INDEX_DEFAULT,
} from "back-end/src/scim/users/listUsers";
import { teamtoScimGroup } from "./getGroup";

export async function listGroups(
  req: ScimListRequest,
  res: Response,
): Promise<Response<ScimListResponse>> {
  const { startIndex, count, filter: filterQuery } = req.query;

  // startIndex queryParam is 1-based so we need to subtract 1
  const queryOptions = {
    startIndex: startIndex ? parseInt(startIndex) - 1 : START_INDEX_DEFAULT,
    count: count ? parseInt(count) : COUNT_DEFAULT,
  };

  const org = req.organization;

  const groups = await getTeamsForOrganization(org.id);
  const expandedMembers = await expandOrgMembers(org.members);

  const hydratedGroups = groups.map((group) => {
    const members = expandedMembers.filter((member) =>
      member.teams?.includes(group.id),
    );
    return {
      ...group,
      members,
    };
  });

  const SCIMGroups = hydratedGroups.map((group) => {
    return teamtoScimGroup(group);
  });

  const filteredGroups = filterQuery
    ? SCIMGroups.filter(filter(parse(filterQuery)))
    : SCIMGroups;

  // a startIndex less than 0 should be interpreted as 0
  const correctedStartIndex =
    queryOptions.startIndex < 0 ? 0 : queryOptions.startIndex;

  const resources = filteredGroups.slice(
    correctedStartIndex,
    correctedStartIndex + queryOptions.count,
  );

  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: filteredGroups.length,
    Resources: resources,
    startIndex: queryOptions.startIndex,
    itemsPerPage:
      resources.length < queryOptions.count
        ? resources.length
        : queryOptions.count,
  });
}
