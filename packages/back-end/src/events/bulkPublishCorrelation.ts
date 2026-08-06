import type { Context } from "back-end/src/models/BaseModel";

/**
 * `*.updated` events held for the duration of one landing.
 *
 * Owned by the landing, not by the context: a producer that suspends carries a
 * REFERENCE to the buffer its write belonged to, because by the time it resumes the
 * context may be pointing at a different landing's buffer.
 */
export type DeferredEventBuffer = {
  entries: Array<{ owner: string; emit: () => Promise<unknown> }>;
  /**
   * Set when the landing ends. The buffer stays reachable afterwards so a late
   * producer is judged by `restored` rather than by the buffer's absence.
   */
  closed?: boolean;
  /**
   * Documents compensation put back. An event — buffered or late — is emitted only
   * for a document NOT in here, which is the one rule every path applies.
   */
  restored: Set<string>;
};

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
/**
 * The buffer a write belongs to, read at the moment of the write.
 *
 * A producer that awaits before emitting has no identity of its own, so reading the
 * context when it RESUMES asks "which release is open now", not "which release did
 * this write belong to". With two landings on one context — an experiment-start loop,
 * the ramp poller — those are different questions and the answers diverge in both
 * directions: an event dropped because an unrelated later landing rolled back, or
 * emitted because an unrelated later landing stood.
 */
export function captureEventBuffer(
  context: Context,
): DeferredEventBuffer | null {
  // A write can only belong to an OPEN landing. A closed buffer left on the context is
  // a finished landing's, and capturing it would judge a brand-new write by that
  // landing's `restored` set — an ordinary update to an entity some earlier release
  // rolled back would go silent. Same predicate the enclosing-scope check applies, so
  // the two agree on what counts as a live landing.
  const buffer = context.bulkPublishDeferredEvents;
  return buffer && !buffer.closed ? buffer : null;
}

export async function emitOrDeferBulkPublishEvent(
  emit: () => Promise<unknown>,
  // The entity this event DESCRIBES. Compensation emits an event only when its
  // entity was not put back, so the tag has to name the document, not the release
  // item: a Config root and the descendants its cascade rewrote belong to one item
  // but are restored independently, and one item-level tag cannot say that the root
  // went back while a descendant did not.
  entityId: string,
  // The buffer this write belonged to, from `captureEventBuffer` at write time.
  //
  // REQUIRED, and `null` rather than optional on purpose. An optional parameter makes
  // `undefined` mean two things — "didn't capture" and "captured, nothing was open" —
  // told apart only by a `??` inside the capture helper. A future caller passing
  // `context.bulkPublishDeferredEvents` directly would type-check and silently restore
  // the bug this parameter exists to prevent, whenever no buffer is open at write
  // time. With no fallback branch there is nothing to fall back TO.
  captured: DeferredEventBuffer | null,
): Promise<void> {
  // Capture never returns a closed buffer, so reaching the closed branch below means
  // it closed while this producer was suspended — the straggler case, and nothing
  // else.
  // No context parameter, deliberately: this decision reads no ambient state. A
  // producer that suspends resumes into whatever landing is open then, and on a
  // context publishing several entities in turn that is a different release with a
  // different verdict — so the only correct input is the buffer handed in.
  if (captured && !captured.closed) {
    captured.entries.push({ owner: entityId, emit });
    return;
  }
  // The landing has ended. Judged by the SAME question the in-window flush asks: was
  // this document put back? A release-wide verdict cannot answer it — a rollback that
  // left one entity durably published has to stay silent about the rest and speak
  // about that one — and each time these were two dispositions, one was wrong.
  if (captured?.closed) {
    if (captured.restored.has(entityId)) return;
    await emit();
    return;
  }
  await emit();
}
