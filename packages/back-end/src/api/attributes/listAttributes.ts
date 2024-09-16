import { ListAttributesResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { listAttributesValidator } from "../../validators/openapi";

export const listAttributes = createApiRequestHandler(listAttributesValidator)(
  async (req): Promise<ListAttributesResponse> => {
    const attributes = (req.context.org.settings?.attributeSchema || []).filter(
      (attribute) =>
        !attribute.archived &&
        req.context.permissions.canReadMultiProjectResource(attribute.projects)
    );

    return { attributes };
  }
);
