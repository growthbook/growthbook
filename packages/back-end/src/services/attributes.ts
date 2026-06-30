import {
  categorizeUnregisteredAttributes,
  extractConditionAttributeKeys,
  getRequireRegisteredAttributesSettings,
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
  const { isOn, requireProjectScoping } =
    getRequireRegisteredAttributesSettings(
      context.org.settings?.requireRegisteredAttributes,
    );
  if (!isOn) return;

  const attributeSchema = context.org.settings?.attributeSchema || [];
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

  // Pass `project` to the categorizer only when the org has opted into the
  // stricter project-scope check; otherwise out-of-project attributes are
  // bucketed as "registered" and pass.
  const { unknown, outOfProject } = categorizeUnregisteredAttributes(
    keys,
    attributeSchema,
    requireProjectScoping ? project : undefined,
  );
  if (!unknown.length && !outOfProject.length) return;

  throw new BadRequestError(
    formatUnregisteredAttributesError(label, { unknown, outOfProject }),
  );
}

// Shared formatter so the message is identical between assertRegisteredAttributes
// and the front-end pre-flight (`validateUnregisteredAttributes` mirrors this).
export function formatUnregisteredAttributesError(
  label: string,
  buckets: { unknown: string[]; outOfProject: string[] },
): string {
  const parts: string[] = [];
  if (buckets.unknown.length) {
    const quoted = buckets.unknown.map((k) => `"${k}"`).join(", ");
    parts.push(`Unknown attribute key(s) on ${label}: ${quoted}.`);
  }
  if (buckets.outOfProject.length) {
    const quoted = buckets.outOfProject.map((k) => `"${k}"`).join(", ");
    parts.push(
      `Attribute key(s) are not part of this project's scope: ${quoted}.`,
    );
  }
  return parts.join("\n");
}
