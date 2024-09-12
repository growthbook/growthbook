import { DeleteAttributeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { deleteAttributeValidator } from "../../validators/openapi";
import { updateOrganization } from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";
import { auditDetailsDelete } from "../../services/audit";

export const deleteAttribute = createApiRequestHandler(
  deleteAttributeValidator
)(
  async (req): Promise<DeleteAttributeResponse> => {
    const id = req.params.id;
    const org = req.context.org;
    const attributes = org.settings?.attributeSchema || [];

    const attribute = attributes.find(
      (attr) => !attr.archived && attr.id === id
    );
    if (!attribute) {
      throw Error(`Attribute with ID ${id} does not exists!`);
    }

    if (!req.context.permissions.canDeleteAttribute(attribute))
      req.context.permissions.throwPermissionError();

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        attributeSchema: [
          ...attributes.filter((attr) => attr.id !== id),
          { ...attribute, archived: true },
        ],
      },
    };

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "attribute.delete",
      entity: {
        object: "attribute",
        id,
      },
      details: auditDetailsDelete(attribute),
    });

    return {
      deletedId: id,
    };
  }
);
