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

/**
 * Emit an entity `*.updated`-style event now — or, during a bulk-publish
 * commit, defer it into `context.bulkPublishDeferredEvents` so it fires only
 * after the whole release commits (and never for a rolled-back one). The one
 * implementation of the defer decision, shared by every model's update hook.
 */
export async function emitOrDeferBulkPublishEvent(
  context: Context,
  emit: () => Promise<unknown>,
): Promise<void> {
  const deferred = context.bulkPublishDeferredEvents;
  if (deferred) {
    deferred.push(emit);
  } else {
    await emit();
  }
}
