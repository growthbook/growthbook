import { isEqual } from "lodash";
import { SimpleSchema } from "shared/types/feature";
import { AncestorFieldCollision } from "shared/util";
import { ConfigInterface } from "shared/types/config";

type NormalizeSchema = (
  config: {
    key?: string;
    parent?: string;
    extends?: string[];
    value?: string;
  },
  schema: SimpleSchema | undefined,
) => Promise<{
  schema: SimpleSchema | undefined;
  identical: AncestorFieldCollision[];
  conflicting: AncestorFieldCollision[];
}>;

/**
 * Apply publish-time "base wins" normalization to a config's staged changes:
 * strip from the schema-to-persist any field key a published ancestor now owns,
 * reporting each collision split by contract equality (the caller rejects
 * `conflicting` on user-authored paths). A lineage change (parent/extends)
 * shifts which keys the bases own, so the config's own schema is re-normalized
 * even when this change didn't touch `schema`. Returns a new changes object
 * with `schema` set when normalization altered the schema that was about to be
 * written; otherwise a shallow copy unchanged. The DB-backed ancestor lookup is
 * injected via `normalize` so the decision logic stays pure/testable.
 *
 * Both the revision `applyChanges` and its `assertPublishable` dry-run must run
 * this before evaluating descendant reconcilability — otherwise the dry-run sees
 * an un-normalized root that still declares an ancestor-owned key and reports a
 * spurious sibling conflict at a composing descendant.
 */
export async function normalizeConfigChangesAgainstAncestors(
  entity: Pick<
    ConfigInterface,
    "key" | "parent" | "extends" | "value" | "schema"
  >,
  filteredChanges: Record<string, unknown>,
  normalize: NormalizeSchema,
): Promise<{
  changes: Record<string, unknown>;
  identical: AncestorFieldCollision[];
  conflicting: AncestorFieldCollision[];
}> {
  const changes = { ...filteredChanges };

  const lineageChanged = changes.parent !== undefined || "extends" in changes;
  // An explicit `schema: null` in the changes is a clear — normalize nothing and
  // leave it null so it persists (and fires the descendant reconcile). Only fall
  // back to the entity's schema when the change doesn't touch `schema` at all;
  // otherwise a combined lineage + schema-clear would resurrect the old schema.
  const schemaProvided = "schema" in changes;
  const schemaToNormalize = schemaProvided
    ? (changes.schema as ConfigInterface["schema"])
    : entity.schema;

  if (!(schemaProvided || lineageChanged) || !schemaToNormalize) {
    return { changes, identical: [], conflicting: [] };
  }

  const {
    schema: normalized,
    identical,
    conflicting,
  } = await normalize(
    {
      key: entity.key,
      parent: (changes.parent as string | undefined) ?? entity.parent,
      extends:
        "extends" in changes
          ? (changes.extends as string[] | undefined)
          : entity.extends,
      value: (changes.value as string | undefined) ?? entity.value,
    },
    schemaToNormalize,
  );

  // Compare against the schema we were about to write (the staged schema or the
  // entity's), not `entity.schema`: a normalized form of a freshly staged schema
  // must still be persisted.
  if (!isEqual(normalized, schemaToNormalize)) {
    changes.schema = normalized;
  }
  return { changes, identical, conflicting };
}
