import { RevisionTargetType } from "shared/enterprise";
import type { ApiReqContext } from "back-end/types/api";
import type { ReqContext } from "back-end/types/request";
import type { Context } from "back-end/src/models/BaseModel";
import type { EntityRevisionAdapter } from "back-end/src/revisions/EntityRevisionAdapter";
import { savedGroupAdapter } from "back-end/src/revisions/adapters/saved-group.adapter";

// Registry mapping entity types to their adapter implementations.
// To add a new entity type:
//   1. Create packages/back-end/src/revisions/adapters/<entity>.adapter.ts
//   2. Add it to this registry
const registry: Record<RevisionTargetType, EntityRevisionAdapter> = {
  "saved-group": savedGroupAdapter as EntityRevisionAdapter,
};

/**
 * Return the adapter for the given entity type.
 * Provides all entity-specific logic (permissions, snapshot building, applying changes, etc.)
 * without hardcoding entity types in the core revision infrastructure.
 */
export function getAdapter(type: RevisionTargetType): EntityRevisionAdapter {
  return registry[type];
}

/**
 * Convenience wrapper that returns the live-entity model for the given type.
 * Delegates to the adapter's getModel() method.
 */
export const getEntityModel = (
  context: ReqContext | ApiReqContext,
  entityType: RevisionTargetType,
) => {
  return getAdapter(entityType).getModel(context as Context);
};
