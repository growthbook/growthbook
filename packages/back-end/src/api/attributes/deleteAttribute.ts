import { deleteAttributeValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsDelete } from "back-end/src/services/audit";
import { hasAnyEventForwarderConfig } from "back-end/src/services/eventForwarderConfig";

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

  const eventForwarderWarning = (await hasAnyEventForwarderConfig(req.context))
    ? "This attribute has been removed from GrowthBook, but its field will be preserved in your event forwarder's data warehouse table to avoid breaking existing data."
    : undefined;

  return {
    deletedProperty: property,
    ...(eventForwarderWarning ? { eventForwarderWarning } : {}),
  };
});
