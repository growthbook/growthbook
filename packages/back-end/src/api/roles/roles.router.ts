import { OpenApiRoute } from "back-end/src/util/handler";
import {
  deleteRole,
  listRoles,
  postRole,
  postRoleActivate,
  postRoleDeactivate,
  putRole,
} from "./roles";

export const rolesRoutes: OpenApiRoute[] = [
  listRoles,
  postRole,
  putRole,
  deleteRole,
  postRoleActivate,
  postRoleDeactivate,
];
