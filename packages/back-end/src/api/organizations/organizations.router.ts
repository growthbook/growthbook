import { OpenApiRoute } from "back-end/src/util/handler";
import { postOrganization } from "./postOrganization";
import { listOrganizations } from "./listOrganizations";
import { putOrganization } from "./putOrganization";

export const organizationsRoutes: OpenApiRoute[] = [
  listOrganizations,
  postOrganization,
  putOrganization,
];
