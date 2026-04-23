import { getNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { toApiNamespace } from "./namespaceApiUtils";

export const getNamespace = createApiRequestHandler(getNamespaceValidator)(
  async (req) => {
    const namespaces = req.context.org.settings?.namespaces ?? [];
    const ns = namespaces.find((n) => n.name === req.params.id);
    if (!ns) {
      throw new Error("Namespace not found");
    }
    return { namespace: toApiNamespace(ns) };
  },
);
