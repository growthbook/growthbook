import type { Document, Filter } from "mongodb";
import { featureRevisionId } from "back-end/src/models/FeatureRevisionModel";

/**
 * Every stored place that names a feature by id, so a rename can't leave a
 * reference behind. `covers` lists the schema paths an entry answers for, in
 * the grammar of `featureIdShapedPaths`; the guard test fails when a schema
 * gains a feature-id-shaped path that no entry or ignore covers.
 */
export interface FeatureIdReference {
  collection: string;
  covers: string[];
  /** The organization's documents that may still name `from`. */
  filter: (ref: RenameRef) => Filter<Document>;
  /** Changed top-level fields, or null when the document no longer names `from`. */
  rewrite: (doc: Document, ref: RenameRef) => Record<string, unknown> | null;
}

export interface RenameRef {
  from: string;
  to: string;
  /** Record keys to probe for per-environment settings. */
  environments: string[];
}

/**
 * Stored places a rename deliberately leaves naming the old id. Audit entries
 * and events are history too, read back through `previousIds`.
 */
export const IGNORED_FEATURE_ID_PATHS: Record<
  string,
  Record<string, string>
> = {
  featurecoderefs: {
    feature: "What the codebase says; matched through previousIds",
    "refs.[].flagKey": "What the codebase says",
  },
  realtimeusages: { features: "Past SDK usage" },
};

// Mongo walks arrays at every level of a dotted path, so one path matches a
// prerequisite nested in any array of rules, steps or actions.
const RAMP_PATCH_PREREQUISITES = [
  "startActions.patch.prerequisites.id",
  "endActions.patch.prerequisites.id",
  "steps.actions.patch.prerequisites.id",
];

function under(prefix: string, paths: string[]): string[] {
  return paths.map((path) => `${prefix}.${path}`);
}

/** Rules stored as an array (v2) or keyed by environment (legacy). */
function rulePrerequisitePaths(prefix: string, environments: string[]) {
  return [
    `${prefix}.prerequisites.id`,
    ...environments.map((env) => `${prefix}.${env}.prerequisites.id`),
  ];
}

function anyOf(paths: string[], value: string): Filter<Document> {
  return { $or: paths.map((path) => ({ [path]: value })) };
}

/**
 * Renames `prerequisites[].id` wherever it appears inside `value`. Every
 * `prerequisites` array in the product names features, so matching on the
 * shape covers rules, patches and legacy layouts alike.
 */
export function renamePrerequisites(
  value: unknown,
  from: string,
  to: string,
): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = renamePrerequisites(item, from, to);
      changed ||= result.changed;
      return result.value;
    });
    return changed ? { value: next, changed } : { value, changed };
  }
  if (!isPlainObject(value)) return { value, changed: false };
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "prerequisites" && Array.isArray(child)) {
      next[key] = child.map((prerequisite) => {
        if (isPlainObject(prerequisite) && prerequisite.id === from) {
          changed = true;
          return { ...prerequisite, id: to };
        }
        return prerequisite;
      });
      continue;
    }
    const result = renamePrerequisites(child, from, to);
    changed ||= result.changed;
    next[key] = result.value;
  }
  return changed ? { value: next, changed } : { value, changed };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

type FieldRewrite = (
  value: unknown,
  doc: Document,
  ref: RenameRef,
  field: string,
) => { value: unknown; changed: boolean };

// Walked from the document so a top-level `prerequisites` field is seen as one.
const prerequisites: FieldRewrite = (value, _doc, { from, to }, field) => {
  const result = renamePrerequisites({ [field]: value }, from, to);
  return {
    value: (result.value as Record<string, unknown>)[field],
    changed: result.changed,
  };
};

const idList: FieldRewrite = (value, _doc, { from, to }) =>
  Array.isArray(value) && value.includes(from)
    ? {
        value: [...new Set(value.map((id) => (id === from ? to : id)))],
        changed: true,
      }
    : { value, changed: false };

const exactId: FieldRewrite = (value, _doc, { from, to }) =>
  value === from ? { value: to, changed: true } : { value, changed: false };

const draftFeatureIds: FieldRewrite = (value, _doc, { from, to }) =>
  Array.isArray(value) &&
  value.some((draft) => isPlainObject(draft) && draft.featureId === from)
    ? {
        value: value.map((draft) =>
          isPlainObject(draft) && draft.featureId === from
            ? { ...draft, featureId: to }
            : draft,
        ),
        changed: true,
      }
    : { value, changed: false };

function whenEntityIsFeature(typeField: string): FieldRewrite {
  return (value, doc, ref, field) =>
    doc[typeField] === "feature"
      ? exactId(value, doc, ref, field)
      : { value, changed: false };
}

/** Runs each field's rewrite and keeps only the fields that changed. */
function rewriteFields(
  fields: Record<string, FieldRewrite>,
): FeatureIdReference["rewrite"] {
  return (doc, ref) => {
    const set: Record<string, unknown> = {};
    for (const [field, rewrite] of Object.entries(fields)) {
      if (doc[field] === undefined) continue;
      const result = rewrite(doc[field], doc, ref, field);
      if (result.changed) set[field] = result.value;
    }
    return Object.keys(set).length ? set : null;
  };
}

export const FEATURE_ID_REFERENCES: FeatureIdReference[] = [
  {
    // The renamed flag's own `id` is written before the cascade runs.
    collection: "features",
    covers: [
      "id",
      "prerequisites",
      "rules.[].prerequisites",
      "environmentSettings.{}.prerequisites",
      "legacyDraft.featureId",
      "legacyDraft.prerequisites",
      "legacyDraft.rules.[].prerequisites",
      "legacyDraft.rampActions.[].startActions.[].patch.prerequisites",
      "legacyDraft.rampActions.[].endActions.[].patch.prerequisites",
      "legacyDraft.rampActions.[].steps.[].actions.[].patch.prerequisites",
    ],
    filter: ({ from, environments }) =>
      anyOf(
        [
          "prerequisites.id",
          ...rulePrerequisitePaths("rules", environments),
          ...environments.flatMap((env) => [
            `environmentSettings.${env}.prerequisites.id`,
            `environmentSettings.${env}.rules.prerequisites.id`,
          ]),
          "legacyDraft.featureId",
          "legacyDraft.prerequisites.id",
          ...rulePrerequisitePaths("legacyDraft.rules", environments),
          ...under("legacyDraft.rampActions", RAMP_PATCH_PREREQUISITES),
        ],
        from,
      ),
    rewrite: rewriteFields({
      prerequisites,
      rules: prerequisites,
      environmentSettings: prerequisites,
      legacyDraft: (value, doc, ref) => {
        const renamed = renamePrerequisites(value, ref.from, ref.to);
        if (
          isPlainObject(renamed.value) &&
          renamed.value.featureId === ref.from
        ) {
          return {
            value: { ...renamed.value, featureId: ref.to },
            changed: true,
          };
        }
        return renamed;
      },
    }),
  },
  {
    // Legacy revisions carry a tuple id built from the feature id; minted
    // ids don't, so only a tuple for `from` moves.
    collection: "featurerevisions",
    covers: [
      "id",
      "featureId",
      "prerequisites",
      "rules.[].prerequisites",
      "rampActions.[].startActions.[].patch.prerequisites",
      "rampActions.[].endActions.[].patch.prerequisites",
      "rampActions.[].steps.[].actions.[].patch.prerequisites",
    ],
    filter: ({ from, environments }) =>
      anyOf(
        [
          "featureId",
          "prerequisites.id",
          ...rulePrerequisitePaths("rules", environments),
          ...under("rampActions", RAMP_PATCH_PREREQUISITES),
        ],
        from,
      ),
    rewrite: rewriteFields({
      id: (value, doc, { from, to }) =>
        typeof doc.version === "number" &&
        value === featureRevisionId(from, doc.version)
          ? { value: featureRevisionId(to, doc.version), changed: true }
          : { value, changed: false },
      featureId: exactId,
      prerequisites,
      rules: prerequisites,
      rampActions: prerequisites,
    }),
  },
  {
    collection: "featurerevisionlog",
    covers: ["featureId"],
    filter: ({ from }) => ({ featureId: from }),
    rewrite: rewriteFields({ featureId: exactId }),
  },
  {
    collection: "experiments",
    covers: [
      "linkedFeatures",
      "pendingFeatureDrafts.[].featureId",
      "phases.[].prerequisites",
    ],
    filter: ({ from }) =>
      anyOf(
        [
          "linkedFeatures",
          "pendingFeatureDrafts.featureId",
          "phases.prerequisites.id",
        ],
        from,
      ),
    rewrite: rewriteFields({
      linkedFeatures: idList,
      pendingFeatureDrafts: draftFeatureIds,
      phases: prerequisites,
    }),
  },
  {
    collection: "contextualbandits",
    covers: [
      "linkedFeatures",
      "pendingFeatureDrafts.[].featureId",
      "prerequisites",
    ],
    filter: ({ from }) =>
      anyOf(
        [
          "linkedFeatures",
          "pendingFeatureDrafts.featureId",
          "prerequisites.id",
        ],
        from,
      ),
    rewrite: rewriteFields({
      linkedFeatures: idList,
      pendingFeatureDrafts: draftFeatureIds,
      prerequisites,
    }),
  },
  {
    // Linked features are keyed by id, and each entry repeats it.
    collection: "holdouts",
    covers: [
      "linkedFeatures",
      "linkedFeatures.{key}",
      "environmentSettings.{}.prerequisites",
    ],
    // Every holdout: a key-path filter misreads ids with dots, and an org
    // has few holdouts.
    filter: () => ({}),
    rewrite: rewriteFields({
      // Built from entries so ids like "__proto__" stay plain keys.
      linkedFeatures: (value, _doc, { from, to }) => {
        if (
          !isPlainObject(value) ||
          !Object.prototype.hasOwnProperty.call(value, from)
        ) {
          return { value, changed: false };
        }
        const item = value[from];
        return {
          value: Object.fromEntries([
            ...Object.entries(value).filter(([key]) => key !== from),
            [to, isPlainObject(item) ? { ...item, id: to } : item],
          ]),
          changed: true,
        };
      },
      environmentSettings: prerequisites,
    }),
  },
  {
    collection: "saferollout",
    covers: ["featureId"],
    filter: ({ from }) => ({ featureId: from }),
    rewrite: rewriteFields({ featureId: exactId }),
  },
  {
    collection: "rampschedules",
    covers: [
      "entityId",
      "targets.[].entityId",
      "startActions.[].patch.prerequisites",
      "endActions.[].patch.prerequisites",
      "steps.[].actions.[].patch.prerequisites",
    ],
    filter: ({ from }) => ({
      $or: [
        { entityType: "feature", entityId: from },
        { targets: { $elemMatch: { entityType: "feature", entityId: from } } },
        ...RAMP_PATCH_PREREQUISITES.map((path) => ({ [path]: from })),
      ],
    }),
    rewrite: rewriteFields({
      entityId: whenEntityIsFeature("entityType"),
      targets: (value, _doc, { from, to }) =>
        Array.isArray(value) &&
        value.some(
          (t) =>
            isPlainObject(t) &&
            t.entityType === "feature" &&
            t.entityId === from,
        )
          ? {
              value: value.map((t) =>
                isPlainObject(t) &&
                t.entityType === "feature" &&
                t.entityId === from
                  ? { ...t, entityId: to }
                  : t,
              ),
              changed: true,
            }
          : { value, changed: false },
      startActions: prerequisites,
      endActions: prerequisites,
      steps: prerequisites,
    }),
  },
  {
    collection: "rampscheduletemplates",
    covers: [
      "endPatch.prerequisites",
      "steps.[].actions.[].patch.prerequisites",
    ],
    filter: ({ from }) =>
      anyOf(
        ["endPatch.prerequisites.id", "steps.actions.patch.prerequisites.id"],
        from,
      ),
    rewrite: rewriteFields({ endPatch: prerequisites, steps: prerequisites }),
  },
  {
    collection: "experimenttemplates",
    covers: ["targeting.prerequisites"],
    filter: ({ from }) => ({ "targeting.prerequisites.id": from }),
    rewrite: rewriteFields({ targeting: prerequisites }),
  },
  {
    collection: "watches",
    covers: ["features"],
    filter: ({ from }) => ({ features: from }),
    rewrite: rewriteFields({ features: idList }),
  },
  {
    collection: "discussions",
    covers: ["parentId"],
    filter: ({ from }) => ({ parentType: "feature", parentId: from }),
    rewrite: rewriteFields({ parentId: whenEntityIsFeature("parentType") }),
  },
  {
    collection: "customhooks",
    covers: ["entityId"],
    filter: ({ from }) => ({ entityType: "feature", entityId: from }),
    rewrite: rewriteFields({ entityId: whenEntityIsFeature("entityType") }),
  },
];
