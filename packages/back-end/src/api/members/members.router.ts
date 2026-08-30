import { OpenApiRoute } from "back-end/src/util/handler";
import { listMembers } from "./listMembers";
import { updateMemberRole } from "./updateMemberRole";
import { deleteMember } from "./deleteMember";

export const membersRoutes: OpenApiRoute[] = [
  listMembers,
  updateMemberRole,
  deleteMember,
];
