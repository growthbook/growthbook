import { applyPatch } from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { cloneDeep } from "lodash";
import {
  JsonPatchOperation,
  normalizeProposedChanges,
} from "shared/enterprise";

// Leaf module (no dependency on revisions/index) so it can be imported from the
// API serializers without creating an import cycle through the adapter registry.

/**
 * Apply a set of JSON Patch ops to a snapshot, returning a new object.
 *
 * Clones with lodash `cloneDeep` (which preserves Date instances) and lets
 * applyPatch mutate that throwaway copy in place (mutateDocument = true).
 * Passing mutateDocument = false would make fast-json-patch internally
 * JSON-clone the input, converting Date fields (e.g. dateCreated/dateUpdated on
 * a saved-group snapshot) into ISO strings and breaking downstream serializers
 * that call `.toISOString()`. (structuredClone would also preserve Dates but is
 * not available in the Jest VM sandbox, so cloneDeep is used for parity.)
 */
export function applyPatchToSnapshot<T extends object>(
  snapshot: T,
  proposedChanges: JsonPatchOperation[] | unknown,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return snapshot;
  return applyPatch(cloneDeep(snapshot), ops as Operation[], false, true)
    .newDocument as T;
}
