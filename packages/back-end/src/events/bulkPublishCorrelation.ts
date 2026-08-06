import type { Context } from "back-end/src/models/BaseModel";

/**
 * Correlation fields for events emitted by a multi-entity publish. The commit
 * phase sets `context.bulkPublishId`; every revision lifecycle event emitted
 * while it is set carries it, so webhook consumers can group one release's
 * events. Leaf module — the event services import it, so it must not import
 * back into the event pipeline.
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
  // The entity this event DESCRIBES. Compensation emits an event only when its
  // entity was not put back, so the tag has to name the document, not the release
  // item: a Config root and the descendants its cascade rewrote belong to one item
  // but are restored independently, and one item-level tag cannot say that the root
  // went back while a descendant did not.
  entityId: string,
): Promise<void> {
  // Read and push with no await between them, so a flush can't interleave and orphan
  // an event pushed while the buffer is open. That is NOT sufficient on its own: some
  // producers (`onFeatureUpdate`) are invoked fire-and-forget and await mid-way, so
  // they can arrive after the release has ended. The buffer therefore stays on the
  // context once closed, carrying what it needs to decide their fate.
  const deferred = context.bulkPublishDeferredEvents;
  if (deferred && !deferred.closed) {
    deferred.entries.push({ owner: entityId, emit });
    return;
  }
  // A straggler, judged by the SAME question the in-window flush asks: was this
  // document put back? A release-wide verdict cannot answer it — a rollback that left
  // one entity durably published has to stay silent about the rest and speak about
  // that one — and each time these were two separate dispositions, one of them was
  // wrong. They are one rule now.
  if (deferred?.closed) {
    if (deferred.restored.has(entityId)) return;
    await emit();
    return;
  }
  await emit();
}
