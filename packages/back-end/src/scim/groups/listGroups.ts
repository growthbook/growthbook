import { parse, filter } from "scim2-parse-filter";
import { Request } from "express";
import { getTeamsForOrganization } from "../../models/TeamModel";
import { expandOrgMembers } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";
import { ApiRequestLocals } from "../../../types/api";

export const listGroups = createApiRequestHandler()(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (req: Request & ApiRequestLocals): Promise<any> => {
    const { startIndex, count, filter: filterQuery } = req.query;

    const org = req.organization;

    const groups = await getTeamsForOrganization(org.id);

    const groupsWithMembersP = groups.map(async (group) => {
      const members = org.members.filter((member) =>
        member.teams?.includes(group.id)
      );
      const expandedMembers = await expandOrgMembers(members);
      return {
        ...group,
        members: expandedMembers,
      };
    });

    const hydratedGroups = await Promise.all(groupsWithMembersP);

    const SCIMGroups = hydratedGroups.map((group) => {
      return {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        id: group.id,
        displayName: group.name,
        members: group.members.map((member) => {
          return { value: member.id, display: member.name };
        }),
        meta: {
          resourceType: "Group",
        },
      };
    });

    const filteredGroups = filterQuery
      ? SCIMGroups.filter(filter(parse(filterQuery as string)))
      : SCIMGroups;

    // change startIndex to be 1-based. if less than 1, make it 1
    const resources = filteredGroups.slice(
      parseInt(startIndex as string),
      parseInt(startIndex as string) + parseInt(count as string)
    );

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: filteredGroups.length,
      Resources: resources,
      startIndex: parseInt(startIndex as string),
      itemsPerPage: parseInt(count as string),
    };
  }
);
