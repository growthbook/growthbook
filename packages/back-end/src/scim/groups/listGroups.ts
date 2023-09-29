import { parse, filter } from "scim2-parse-filter";
import { getTeamsForOrganization } from "../../models/TeamModel";
import {
  expandOrgMembers,
  getOrganizationById,
} from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";

export const listGroups = createApiRequestHandler()(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (req: any): Promise<any> => {
    // console.log("listGroups endpoint was called");

    const { startIndex, count, filter: filterQuery } = req.query;

    const orgId = req.organization;

    const org = await getOrganizationById(orgId);

    if (!org) {
      // Return an error in the shape SCIM is expecting
      return;
    }

    const groups = await getTeamsForOrganization(orgId);

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

    const f = filter(parse(filterQuery));

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: SCIMGroups.length,
      Resources: SCIMGroups.filter(f),
      startIndex: parseInt(startIndex),
      itemsPerPage: parseInt(count),
    };
  }
);
