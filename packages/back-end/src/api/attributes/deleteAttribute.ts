import { deleteAttributeValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { syncManagedWarehouseIdentifiersOnAttributeChange } from "back-end/src/services/clickhouse";
import { syncEventForwarderAfterAttributeSchemaChange } from "back-end/src/services/eventForwarder/attributeSync";

export const deleteAttribute = createApiRequestHandler(
  deleteAttributeValidator,
)(async (req) => {
  const property = req.params.property;
  const org = req.context.org;
  const attributes = org.settings?.attributeSchema || [];

  const attribute = attributes.find((attr) => attr.property === property);

  if (!attribute) {
    throw Error(`An attribute with property ${property} does not exists!`);
  }

  if (!req.context.permissions.canDeleteAttribute(attribute))
    req.context.permissions.throwPermissionError();

  const updatedAttributeSchema = attributes.filter(
    (attr) => attr.property !== property,
  );

  const updates: Partial<OrganizationInterface> = {
    settings: {
      ...org.settings,
      attributeSchema: updatedAttributeSchema,
    },
  };

  await updateOrganization(org.id, updates);

  await syncManagedWarehouseIdentifiersOnAttributeChange(
    req.context,
    updatedAttributeSchema,
  );

  await syncEventForwarderAfterAttributeSchemaChange(req.context, {
    attributeSchema: updatedAttributeSchema,
  });

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
