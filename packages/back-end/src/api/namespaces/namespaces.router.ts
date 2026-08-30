import { OpenApiRoute } from "back-end/src/util/handler";
import { listNamespaces } from "./listNamespaces";
import { getNamespace } from "./getNamespace";
import { postNamespace } from "./postNamespace";
import { putNamespace } from "./putNamespace";
import { deleteNamespace } from "./deleteNamespace";
import { getNamespaceMemberships } from "./getNamespaceMemberships";
import { postNamespaceRotateSeed } from "./postNamespaceRotateSeed";

export const namespacesRoutes: OpenApiRoute[] = [
  listNamespaces,
  postNamespace,
  getNamespace,
  putNamespace,
  deleteNamespace,
  getNamespaceMemberships,
  postNamespaceRotateSeed,
];
