import {
  apiAddTeamMembersValidator,
  apiCreateTeamBody,
  apiDeleteTeamValidator,
  apiDeleteTeamReturn,
  apiRemoveTeamMemberValidator,
  apiTeamValidator,
  apiUpdateTeamBody,
} from "shared/validators";
import { statusCodeReturn } from "back-end/src/util/handler";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const addTeamMembersEndpoint = {
  pathFragment: "/:id/members",
  verb: "post" as const,
  operationId: "addTeamMembers",
  validator: apiAddTeamMembersValidator,
  zodReturnObject: statusCodeReturn,
  summary: "Add members to team",
};

export const removeTeamMemberEndpoint = {
  pathFragment: "/:id/members",
  verb: "delete" as const,
  operationId: "removeTeamMember",
  validator: apiRemoveTeamMemberValidator,
  zodReturnObject: statusCodeReturn,
  summary: "Remove members from team",
};

export const deleteTeamEndpoint = {
  pathFragment: "/:id",
  verb: "delete" as const,
  operationId: "deleteTeam",
  validator: apiDeleteTeamValidator,
  zodReturnObject: apiDeleteTeamReturn,
  summary: "Delete a single team",
};

export const teamApiSpec = {
  modelSingular: "team",
  modelPlural: "teams",
  pathBase: "/teams",
  apiInterface: apiTeamValidator,
  schemas: {
    createBody: apiCreateTeamBody,
    updateBody: apiUpdateTeamBody,
  },
  crudActions: ["get", "create", "list", "update"],
  customEndpoints: [
    addTeamMembersEndpoint,
    removeTeamMemberEndpoint,
    deleteTeamEndpoint,
  ],
} satisfies OpenApiModelSpec;
export default teamApiSpec;
