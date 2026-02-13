import { PutAttributeResponse } from "shared/types/openapi";
import { putAttributeValidator } from "shared/validators";
import { OrganizationInterface } from "shared/types/organization";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { validatePayload } from "./validations.js";

export const putAttribute = createApiRequestHandler(putAttributeValidator)(
  async (req): Promise<PutAttributeResponse> => {
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

    if (
      !req.context.permissions.canUpdateAttribute(attribute, updatedAttribute)
    )
      req.context.permissions.throwPermissionError();

    const updates: Partial<OrganizationInterface> = {
      settings: {
        ...org.settings,
        attributeSchema: attributes.map((attr) =>
          attr.property === property ? updatedAttribute : attr,
        ),
      },
    };

    await updateOrganization(org.id, updates);

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
