import {
  extractConditionAttributeKeys,
  findUnregisteredAttributes,
} from "shared/util";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { BadRequestError } from "back-end/src/util/errors";
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

// Rejects saves that reference attribute keys not declared (and not archived)
// in the org's attributeSchema. No-op unless the org opts in via
// `settings.requireRegisteredAttributes`. Mirrors the existing saved-group
// "Unknown attributeKey" behavior so feature rules and experiments can't
// silently ship dead targeting due to typos like account_uuid vs accountUUID.
//
// `condition` must be a raw JSON string — this helper does not validate JSON
// shape (that's `validateCondition`'s job); it only scans field names after
// parsing and silently returns if parsing fails.
type AttributeParts = {
  hashAttribute?: string | null;
  fallbackAttribute?: string | null;
  condition?: string | null;
};

// When `existingParts` is provided, only validates fields that actually
// changed — so pre-existing violations don't block unrelated edits.
// When `project` is provided, attributes scoped to other projects are
// treated as unregistered (matches the frontend dropdown filtering).
export function assertRegisteredAttributes(
  context: ReqContext,
  parts: AttributeParts,
  label: string,
  existingParts?: AttributeParts,
  project?: string | string[],
): void {
  if (!context.org.settings?.requireRegisteredAttributes) return;

  const attributeSchema = context.org.settings.attributeSchema || [];
  const keys: string[] = [];

  const changed = (field: keyof AttributeParts): boolean =>
    !!parts[field] && (!existingParts || parts[field] !== existingParts[field]);

  if (changed("hashAttribute")) keys.push(parts.hashAttribute!);
  if (changed("fallbackAttribute")) keys.push(parts.fallbackAttribute!);

  if (changed("condition") && parts.condition !== "{}") {
    try {
      const parsed = JSON.parse(parts.condition!);
      keys.push(...extractConditionAttributeKeys(parsed));
    } catch {
      // Unparseable condition — `validateCondition` elsewhere will surface
      // the JSON error. Don't double-throw here.
    }
  }

  if (!keys.length) return;

  const unknown = findUnregisteredAttributes(keys, attributeSchema, project);
  if (!unknown.length) return;

  const quoted = unknown.map((k) => `"${k}"`).join(", ");
  throw new BadRequestError(
    `Unknown attribute key(s) on ${label}: ${quoted}. ` +
      `Declare them under Settings > Targeting Attributes or fix the typo.`,
  );
}
