import { GetNamespaceResponse } from "shared/types/openapi";
import { getNamespaceValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getNamespace = createApiRequestHandler(getNamespaceValidator)(
  async (req): Promise<GetNamespaceResponse> => {
    const { id } = req.params;
    const namespaces = req.context.org.settings?.namespaces || [];
    const namespace = namespaces.find((n) => n.name === id);
    if (!namespace) {
      throw new Error("Namespace not found.");
    }
    return {
      namespace,
    };
  },
);
