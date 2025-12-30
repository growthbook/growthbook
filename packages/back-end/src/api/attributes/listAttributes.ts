import { ListAttributesResponse } from "shared/types/openapi";
import { listAttributesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const listAttributes = createApiRequestHandler(listAttributesValidator)(
  async (req): Promise<ListAttributesResponse> => {
    const attributes = (req.context.org.settings?.attributeSchema || []).filter(
      (attribute) =>
        !attribute.archived &&
        req.context.permissions.canReadMultiProjectResource(attribute.projects),
    );

    return { attributes };
  },
);
