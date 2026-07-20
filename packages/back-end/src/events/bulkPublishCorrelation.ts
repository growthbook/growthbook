import type { Context } from "back-end/src/models/BaseModel";

/**
 * Correlation fields for events emitted by a multi-entity publish
 * (POST /releases/publish-revisions). The commit phase sets
 * `context.bulkPublishId`; every revision lifecycle event emitted while it is
 * set carries it, so webhook consumers can group one release's events.
 * Empty (field absent) on single-entity publishes. Leaf module — the event
 * services import it, so it must not import back into the event pipeline.
 */
export function bulkPublishFields(context: Context): {
  bulkPublishId?: string;
} {
  return context.bulkPublishId ? { bulkPublishId: context.bulkPublishId } : {};
}
