import { ListNamespacesResponse } from "shared/types/openapi";
import { listNamespacesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listNamespaces = createApiRequestHandler(listNamespacesValidator)(
  async (req): Promise<ListNamespacesResponse> => {
    const namespaces = req.context.org.settings?.namespaces || [];
    return {
      namespaces,
    };
  },
);
