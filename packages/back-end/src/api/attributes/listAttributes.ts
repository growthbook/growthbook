import { v4 as uuidv4 } from "uuid";
import { ListAttributesResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { listAttributesValidator } from "../../validators/openapi";
import {
  OrganizationInterface,
  SDKAttribute,
} from "../../../types/organization";
import { updateOrganization } from "../../models/OrganizationModel";

export const listAttributes = createApiRequestHandler(listAttributesValidator)(
  async (req): Promise<ListAttributesResponse> => {
    const orgAttributes = (
      req.context.org.settings?.attributeSchema || []
    ).filter(
      (attribute) =>
        !attribute.archived &&
        req.context.permissions.canReadMultiProjectResource(attribute.projects)
    );

    const attributesWithoutId = orgAttributes
      .filter((attr) => !attr.id)
      .map((attr) => ({ ...attr, id: uuidv4() }));

    const attributesWithId = orgAttributes.filter(
      (attr) => attr.id
    ) as (SDKAttribute & { id: string })[];

    const attributes = [...attributesWithId, ...attributesWithoutId];

    if (attributesWithoutId.length) {
      const org = req.context.org;
      const updates: Partial<OrganizationInterface> = {
        settings: {
          ...org.settings,
          attributeSchema: attributes,
        },
      };

      await updateOrganization(org.id, updates);
    }

    return { attributes };
  }
);
