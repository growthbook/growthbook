import { putAttributeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateAttributeSchema } from "back-end/src/services/attributes";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { addTagsDiff } from "back-end/src/models/TagModel";
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

    if (
      !req.context.permissions.canUpdateAttribute(attribute, updatedAttribute)
    )
      req.context.permissions.throwPermissionError();

    const bodyTags = req.body.tags;
    if (bodyTags !== undefined) {
      await addTagsDiff(org.id, attribute.tags || [], bodyTags);
    }

    const { persistedAttributeSchema } = await updateAttributeSchema(
      req.context,
      {
        newAttributeSchema: attributes.map((attr) =>
          attr.property === property ? updatedAttribute : attr,
        ),
      },
    );

    await req.audit({
      event: "attribute.update",
      entity: {
        object: "attribute",
        id: attribute.property,
      },
      details: auditDetailsUpdate(attribute, updatedAttribute),
    });

    // Read back the canonical version from the persisted schema. On a
    // first-time managed-warehouse migration `updateAttributeSchema` may
    // fold in backfilled attributes alongside this update; this lookup
    // ensures the response reflects exactly what's now stored.
    const persistedAttribute =
      persistedAttributeSchema.find((a) => a.property === property) ??
      updatedAttribute;

    return {
      attribute: persistedAttribute,
    };
  },
);
