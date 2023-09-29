import { OrganizationInterface } from "../../../types/organization";
import { createTeam } from "../../models/TeamModel";
import { createApiRequestHandler } from "../../util/handler";
import { GetGroupResponse } from "./getGroup";

interface SCIMMember {
  value: string; // unclear what the idP expects this to be
  display: string; // Member's full name or username?
}
interface CreateGroupBody {
  schemas: string[];
  displayName: string;
  members: SCIMMember[];
}

export const createGroup = createApiRequestHandler()(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (req: any): Promise<GetGroupResponse> => {
    // console.log("createGroup endpoint was called");

    const requestBody = req.body.toString("utf-8");

    const requestBodyObject = JSON.parse(requestBody) as CreateGroupBody;

    const org = req.organization as OrganizationInterface;

    if (!org) {
      // Return an error in the shape SCIM is expecting
    }

    const DEFAULT_TEAM_PERMISSIONS = {
      role: "collaborator",
      limitAccessByEnvironment: false,
      environments: [],
    };

    const group = await createTeam({
      name: requestBodyObject.displayName,
      createdBy: "SCIM",
      description: "this is a test.",
      organization: org.id,
      ...DEFAULT_TEAM_PERMISSIONS,
    });

    return {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
      id: group.id,
      displayName: group.name,
      members: [],
      meta: {
        resourceType: "Group",
      },
    };
  }
);
