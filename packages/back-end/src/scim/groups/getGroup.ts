import { OrganizationInterface } from "../../../types/organization";
import { findTeamById } from "../../models/TeamModel";
import { expandOrgMembers } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";

interface SCIMMember {
  value: string;
  display: string;
}
export interface GetGroupResponse {
  schemas: string[];
  id: string;
  displayName: string;
  members: SCIMMember[];
  meta: {
    resourceType: "Group";
  };
}

export const getGroup = createApiRequestHandler()(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (req: any): Promise<GetGroupResponse> => {
    // console.log("listGroups endpoint was called");

    const { id } = req.params;

    const org = req.organization as OrganizationInterface;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    const group = await findTeamById(id, org.id);
    const members = org.members.filter((member) => member.teams?.includes(id));
    const expandedMembers = await expandOrgMembers(members);

    if (!group) {
      throw Error;
    }

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      displayName: group.name,
      members: expandedMembers.map((member) => {
        return { value: member.id, display: member.name };
      }),
      meta: {
        resourceType: "Group",
      },
    };
  }
);
