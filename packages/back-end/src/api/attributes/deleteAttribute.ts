import { DeleteAttributeResponse } from "shared/types/openapi";
import { deleteAttributeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { OrganizationInterface } from "back-end/types/organization";
import { auditDetailsDelete } from "back-end/src/services/audit";

export const deleteAttribute = createApiRequestHandler(
  deleteAttributeValidator,
)(async (req): Promise<DeleteAttributeResponse> => {
  const property = req.params.property;
  const org = req.context.org;
  const attributes = org.settings?.attributeSchema || [];

  const attribute = attributes.find((attr) => attr.property === property);

  if (!attribute) {
    throw Error(`An attribute with property ${property} does not exists!`);
  }

  if (!req.context.permissions.canDeleteAttribute(attribute))
    req.context.permissions.throwPermissionError();

  const updates: Partial<OrganizationInterface> = {
    settings: {
      ...org.settings,
      attributeSchema: [...attributes.filter((attr) => attr !== attribute)],
    },
  };

  await updateOrganization(org.id, updates);

  await req.audit({
    event: "attribute.delete",
    entity: {
      object: "attribute",
      id: property,
    },
    details: auditDetailsDelete(attribute),
  });

  return {
    deletedProperty: property,
  };
});
