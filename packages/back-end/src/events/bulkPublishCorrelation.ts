import type { Context } from "back-end/src/models/BaseModel";

// Bare ids can collide across entity types.
export function entityKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

export type DeferredEventBuffer = {
  entries: Array<{ owner: string; emit: () => Promise<unknown> }>;
  closed?: boolean;
  restored: Set<string>;
};

export function bulkPublishFields(context: Context): {
  bulkPublishId?: string;
} {
  return context.bulkPublishId ? { bulkPublishId: context.bulkPublishId } : {};
}

// Capture the open landing's buffer at write time.
export function captureEventBuffer(
  context: Context,
): DeferredEventBuffer | null {
  const buffer = context.bulkPublishDeferredEvents;
  return buffer && !buffer.closed ? buffer : null;
}

export async function emitOrDeferBulkPublishEvent(
  emit: () => Promise<unknown>,
  entityId: string,
  // Explicitly nullable so every caller captures at write time.
  captured: DeferredEventBuffer | null,
): Promise<void> {
  if (captured && !captured.closed) {
    captured.entries.push({ owner: entityId, emit });
    return;
  }
  // Late events emit only when compensation did not restore this document.
  if (captured?.closed) {
    if (captured.restored.has(entityId)) return;
    await emit();
    return;
  }
  await emit();
}
