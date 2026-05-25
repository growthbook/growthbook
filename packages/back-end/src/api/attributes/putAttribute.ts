import { putAttributeValidator } from "shared/validators";
import { attributeUpdateAffectsEventForwarderFactTableColumns } from "shared/util";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { hasAnyEventForwarderConfig } from "back-end/src/services/eventForwarderConfig";
import { syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema } from "back-end/src/services/eventForwarderUserIdTypes";
import { queueEventForwarderEventsFactTablesColumnsRefresh } from "back-end/src/services/eventForwarderFactTable";
import { validatePayload } from "./validations";

export const putAttribute = createApiRequestHandler(putAttributeValidator)(
  async (req) => {
    const property = req.params.property;
    const org = req.context.org;
    const attributes = org.settings?.attributeSchema || [];

    const attribute = attributes.find((attr) => attr.property === property);
    if (!attribute) {
      throw Error(`An attribute with property ${property} does not exists!`);
    }

    const rawUpdatedAttribute = { ...attribute, ...req.body };

    const updatedAttribute = {
      ...rawUpdatedAttribute,
      ...(await validatePayload(req.context, rawUpdatedAttribute)),
    };

    const hasEventForwarder = await hasAnyEventForwarderConfig(req.context);
    if (
      hasEventForwarder &&
      req.body.datatype !== undefined &&
      req.body.datatype !== attribute.datatype
    ) {
      throw new Error(
        "Attribute data type can't be changed while an Event Forwarder is configured.",
      );
    }
    if (
      !req.context.permissions.canUpdateAttribute(attribute, updatedAttribute)
    )
      req.context.permissions.throwPermissionError();

    const bodyTags = req.body.tags;
    if (bodyTags !== undefined) {
      await addTagsDiff(org.id, attribute.tags || [], bodyTags);
    }

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        attributeSchema: attributes.map((attr) =>
          attr.property === property ? updatedAttribute : attr,
        ),
      },
    };

    await updateOrganization(org.id, updates);

    const updatedAttributeSchema = updates.settings?.attributeSchema ?? [];
    if (hasEventForwarder) {
      if (
        attributeUpdateAffectsEventForwarderFactTableColumns(
          attribute,
          updatedAttribute,
        )
      ) {
        await queueEventForwarderEventsFactTablesColumnsRefresh(req.context);
      }
      if (req.body.hashAttribute === true && !attribute.hashAttribute) {
        await syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
          req.context,
          updatedAttributeSchema,
        );
      }
    }

    await req.audit({
      event: "attribute.update",
      entity: {
        object: "attribute",
        id: attribute.property,
      },
      details: auditDetailsUpdate(attribute, updatedAttribute),
    });

    return {
      attribute: updatedAttribute,
    };
  },
);
