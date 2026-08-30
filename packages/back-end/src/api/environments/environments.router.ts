import { OpenApiRoute } from "back-end/src/util/handler";
import { listEnvironments } from "./listEnvironments";
import { putEnvironment } from "./putEnvironment";
import { postEnvironment } from "./postEnvironment";
import { deleteEnvironment } from "./deleteEnvironment";

export const environmentsRoutes: OpenApiRoute[] = [
  listEnvironments,
  postEnvironment,
  putEnvironment,
  deleteEnvironment,
];
