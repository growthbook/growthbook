import { listNamespacesValidator } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { orgNamespaceToApi } from "./namespaceApiUtils";

export const listNamespaces = createApiRequestHandler(listNamespacesValidator)(
  async (req) => {
    const namespaces = req.context.org.settings?.namespaces ?? [];

    const { filtered, returnFields } = applyPagination(
      [...namespaces].sort((a, b) => a.name.localeCompare(b.name)),
      req.query,
    );

    return {
      namespaces: filtered.map(orgNamespaceToApi),
      ...returnFields,
    };
  },
);
