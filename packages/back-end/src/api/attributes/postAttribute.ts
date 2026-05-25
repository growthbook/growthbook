import { postAttributeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateAttributeSchema } from "back-end/src/services/attributes";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { addTags } from "back-end/src/models/TagModel";
import { validatePayload } from "./validations";

export const postAttribute = createApiRequestHandler(postAttributeValidator)(
  async (req) => {
    const attribute = {
      ...req.body,
      ...(await validatePayload(req.context, req.body)),
    };

    const org = req.context.org;

    if (
      org.settings?.attributeSchema?.some(
        (attr) => attr.property === attribute.property,
      )
    ) {
      throw Error(
        `An attribute with property ${attribute.property} already exists!`,
      );
    }

    if (!req.context.permissions.canCreateAttribute(attribute))
      req.context.permissions.throwPermissionError();

    const tags = req.body.tags ?? [];
    if (tags.length > 0) {
      await addTags(org.id, tags);
    }

    const { persistedAttributeSchema } = await updateAttributeSchema(
      req.context,
      {
        newAttributeSchema: [
          ...(org.settings?.attributeSchema || []),
          attribute,
        ],
      },
    );

    await req.audit({
      event: "attribute.create",
      entity: {
        object: "attribute",
        id: attribute.property,
      },
      details: auditDetailsCreate(attribute),
    });

    // Read back the canonical version from the persisted schema. On a
    // first-time managed-warehouse migration `updateAttributeSchema` may
    // fold in backfilled attributes alongside this create; this lookup
    // ensures the response reflects exactly what's now stored.
    const persistedAttribute =
      persistedAttributeSchema.find((a) => a.property === attribute.property) ??
      attribute;

    return {
      attribute: persistedAttribute,
    };
  },
);
