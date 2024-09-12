import { PutAttributeResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { putAttributeValidator } from "../../validators/openapi";
import { updateOrganization } from "../../models/OrganizationModel";
import { OrganizationInterface } from "../../../types/organization";
import { auditDetailsUpdate } from "../../services/audit";
import { validatePayload } from "./validations";

export const putAttribute = createApiRequestHandler(putAttributeValidator)(
  async (req): Promise<PutAttributeResponse> => {
    const id = req.params.id;
    const org = req.context.org;
    const attributes = org.settings?.attributeSchema || [];

    const attribute = attributes.find(
      (attr) => !attr.archived && attr.id === id
    );
    if (!attribute) {
      throw Error(`Attribute with ID ${id} does not exists!`);
    }

    const rawUpdatedAttribute = { id, ...attribute, ...req.body };

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
          attr.id === id ? updatedAttribute : attr
        ),
      },
    };

    await updateOrganization(org.id, updates);

    await req.audit({
      event: "attribute.update",
      entity: {
        object: "attribute",
        id,
      },
      details: auditDetailsUpdate(attribute, updatedAttribute),
    });

    return {
      attribute: updatedAttribute,
    };
  }
);
