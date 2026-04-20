import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { ReqContext } from "back-end/types/request";

export async function removeTagInAttribute(
  context: ReqContext,
  tag: string,
): Promise<void> {
  const { org } = context;
  const attributeSchema = org.settings?.attributeSchema || [];

  const hasTag = attributeSchema.some((a) => (a.tags || []).includes(tag));
  if (!hasTag) return;

  const updatedAttributeSchema = attributeSchema.map((attr) => ({
    ...attr,
    tags: (attr.tags || []).filter((t) => t !== tag),
  }));

  await updateOrganization(org.id, {
    settings: {
      ...org.settings,
      attributeSchema: updatedAttributeSchema,
    },
  });
}
