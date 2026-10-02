import { keyBy } from "lodash";
import omit from "lodash/omit";
import pick from "lodash/pick";
import pickBy from "lodash/pickBy";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { hasVisualChanges } from "shared/util";
import {
  VisualChange,
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "shared/types/visual-changeset";
import { ApiVisualChangeset } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { visualChangesetsHaveChanges } from "back-end/src/services/experiments";
import type {
  ChangesetOwner,
  OwnerVariation,
} from "back-end/src/services/changesetOwner";
import { ApiReqContext } from "back-end/types/api";

const visualChangesetURLPatternSchema =
  new mongoose.Schema<VisualChangesetURLPattern>(
    {
      include: Boolean,
      type: {
        type: String,
        enum: ["simple", "regex"],
        required: true,
      },
      pattern: {
        type: String,
        required: true,
      },
    },
    {
      _id: false,
    },
  );

/**
 * VisualChangeset is a collection of visual changes that are grouped together
 * by a single url target. They are many-to-one with Experiments.
 */
const visualChangesetSchema = new mongoose.Schema<VisualChangesetInterface>({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  organization: {
    type: String,
    index: true,
    required: true,
  },
  urlPatterns: {
    type: [visualChangesetURLPatternSchema],
    required: true,
  },
  editorUrl: {
    type: String,
    required: true,
  },
  experiment: {
    type: String,
    index: true,
    required: true,
  },
  // VisualChanges are associated with one of the variations of the experiment
  // associated with the VisualChangeset
  visualChanges: {
    type: [
      {
        _id: false,
        id: {
          type: String,
          required: true,
        },
        description: String,
        css: String,
        js: String,
        variation: {
          type: String,
          index: true,
          required: true,
        },
        domMutations: [
          {
            _id: false,
            selector: { type: String, required: true },
            action: {
              type: String,
              enum: ["append", "set", "remove"],
              required: true,
            },
            attribute: { type: String, required: true },
            value: String,
            parentSelector: String,
            insertBeforeSelector: String,
          },
        ],
      },
    ],
    required: true,
  },
});

export type VisualChangesetDocument = mongoose.Document &
  VisualChangesetInterface;

export const VisualChangesetModel = mongoose.model<VisualChangesetInterface>(
  "VisualChangeset",
  visualChangesetSchema,
);

const toInterface = (doc: VisualChangesetDocument): VisualChangesetInterface =>
  omit(doc.toJSON<VisualChangesetDocument>({ flattenMaps: true }), [
    "__v",
    "_id",
  ]);

export function toVisualChangesetApiInterface(
  visualChangeset: VisualChangesetInterface,
): ApiVisualChangeset {
  return {
    id: visualChangeset.id,
    urlPatterns: visualChangeset.urlPatterns,
    editorUrl: visualChangeset.editorUrl,
    experiment: visualChangeset.experiment,
    visualChanges: visualChangeset.visualChanges.map((c) => ({
      id: c.id,
      description: c.description,
      css: c.css,
      js: c.js,
      variation: c.variation,
      domMutations: c.domMutations,
    })),
  };
}

export async function findVisualChangesetById(
  id: string,
  organization: string,
): Promise<VisualChangesetInterface | null> {
  const visualChangeset = await VisualChangesetModel.findOne({
    organization,
    id,
  });
  return visualChangeset ? toInterface(visualChangeset) : null;
}

export async function findVisualChangesetsByExperiment(
  experiment: string,
  organization: string,
): Promise<VisualChangesetInterface[]> {
  const visualChangesets = await VisualChangesetModel.find({
    experiment,
    organization,
  });
  return visualChangesets.map(toInterface);
}

export async function countVisualChangesetsByExperiment(
  experiment: string,
  organization: string,
): Promise<number> {
  return VisualChangesetModel.countDocuments({ experiment, organization });
}

export async function findVisualChangesetsByExperimentIds(
  experimentIds: string[],
  organization: string,
  limit?: number,
): Promise<VisualChangesetInterface[]> {
  if (!experimentIds.length) return [];
  let query = VisualChangesetModel.find({
    organization,
    experiment: { $in: experimentIds },
  });
  if (limit && limit > 0) {
    query = query.sort({ _id: -1 }).limit(limit);
  }
  return (await query).map(toInterface);
}

export async function findVisualChangesets(
  organization: string,
  // When set, returns the newest `limit` changesets (sorted by `_id`,
  // which embeds the creation timestamp). Omit for the full unordered set.
  limit?: number,
): Promise<VisualChangesetInterface[]> {
  let query = VisualChangesetModel.find({ organization });
  if (limit && limit > 0) {
    query = query.sort({ _id: -1 }).limit(limit);
  }
  return (await query).map(toInterface);
}

export async function createVisualChange(
  context: ReqContext | ApiReqContext,
  id: string,
  visualChange: VisualChange,
  owner: ChangesetOwner | null,
): Promise<{ nModified: number }> {
  const organization = context.org.id;
  const visualChangeset = await findVisualChangesetById(id, organization);

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const visualChanges = [...visualChangeset.visualChanges, visualChange];
  const res = await VisualChangesetModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: { visualChanges },
    },
  );

  await onVisualChangesetUpdate({
    oldVisualChangeset: visualChangeset,
    newVisualChangeset: { ...visualChangeset, visualChanges },
    owner,
  });

  return { nModified: res.modifiedCount };
}

export async function updateVisualChange({
  context,
  owner,
  changesetId,
  visualChangeId,
  payload,
}: {
  context: ReqContext | ApiReqContext;
  owner: ChangesetOwner | null;
  changesetId: string;
  visualChangeId: string;
  payload: Partial<VisualChange>;
}): Promise<{ nModified: number }> {
  const organization = context.org.id;
  const visualChangeset = await findVisualChangesetById(
    changesetId,
    organization,
  );

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  // Strip `id` from the payload so callers can't rename a visual change
  // and orphan it from the URL-param id used to look it up.
  const safePayload = omit(payload, ["id"]);
  const visualChanges = visualChangeset.visualChanges.map((visualChange) => {
    if (visualChange.id === visualChangeId) {
      return {
        ...visualChange,
        ...safePayload,
      };
    }
    return visualChange;
  });

  const res = await VisualChangesetModel.updateOne(
    {
      id: changesetId,
      organization,
    },
    {
      $set: { visualChanges },
    },
  );

  await onVisualChangesetUpdate({
    oldVisualChangeset: visualChangeset,
    newVisualChangeset: { ...visualChangeset, visualChanges },
    owner,
  });

  return { nModified: res.modifiedCount };
}

export const genNewVisualChange = (
  variation: Pick<OwnerVariation, "id">,
): VisualChange => ({
  id: uniqid("vc_"),
  variation: variation.id,
  description: "",
  css: "",
  domMutations: [],
});

export const createVisualChangeset = async ({
  owner,
  context,
  urlPatterns,
  editorUrl,
  visualChanges,
}: {
  owner: ChangesetOwner;
  context: ReqContext | ApiReqContext;
  urlPatterns: VisualChangesetURLPattern[];
  editorUrl: VisualChangesetInterface["editorUrl"];
  visualChanges?: VisualChange[];
}): Promise<VisualChangesetInterface> => {
  const visualChangeset = toInterface(
    await VisualChangesetModel.create({
      id: uniqid("vcs_"),
      experiment: owner.id,
      organization: context.org.id,
      urlPatterns,
      editorUrl,
      visualChanges:
        visualChanges || owner.editableVariations().map(genNewVisualChange),
    }),
  );

  // mark the owner as having a visual changeset
  await owner.setHasVisualChangesets(true);

  await onVisualChangesetCreate({
    visualChangeset,
    owner,
  });

  return visualChangeset;
};

type VisualChangeUpdate = Partial<VisualChange> &
  Pick<VisualChange, "variation">;

export type VisualChangesetUpdates = {
  editorUrl?: string;
  urlPatterns?: VisualChangesetURLPattern[];
  visualChanges?: VisualChangeUpdate[];
};

// type guard
const _isUpdatingVisualChanges = (
  updates: VisualChangesetUpdates,
): updates is {
  visualChanges: VisualChangeUpdate[];
} & VisualChangesetUpdates => updates.visualChanges !== undefined;

const UPDATABLE_VISUAL_CHANGESET_FIELDS = [
  "editorUrl",
  "urlPatterns",
  "visualChanges",
] as const;

export const updateVisualChangeset = async ({
  visualChangeset,
  owner,
  context,
  updates,
  bypassWebhooks,
}: {
  visualChangeset: VisualChangesetInterface;
  owner: ChangesetOwner | null;
  context: ReqContext | ApiReqContext;
  updates: VisualChangesetUpdates;
  bypassWebhooks?: boolean;
}) => {
  // pick() preserves explicit-undefined keys, which would flow into $set and
  // could unset fields if Mongoose's casting behavior changes. Strip them.
  const safeUpdates = pickBy(
    pick(updates, UPDATABLE_VISUAL_CHANGESET_FIELDS),
    (value) => value !== undefined,
  ) as VisualChangesetUpdates;
  const isUpdatingVisualChanges = _isUpdatingVisualChanges(safeUpdates);

  // For partial updates, merge with the existing visual change by id so
  // fields the caller omitted aren't wiped. Brand-new entries (no id, or an
  // id that doesn't match an existing change) get defaults applied.
  const existingVisualChangesById = keyBy(
    visualChangeset.visualChanges || [],
    "id",
  );
  const visualChanges = isUpdatingVisualChanges
    ? safeUpdates.visualChanges.map((vc) => {
        const existing = vc.id ? existingVisualChangesById[vc.id] : undefined;
        if (existing) {
          return { ...existing, ...vc };
        }
        return {
          description: "",
          css: "",
          domMutations: [],
          ...vc,
          id: vc.id || uniqid("vc_"),
        };
      })
    : visualChangeset.visualChanges || [];

  const res = await VisualChangesetModel.updateOne(
    {
      id: visualChangeset.id,
      organization: context.org.id,
    },
    {
      $set: {
        ...safeUpdates,
        visualChanges,
      },
    },
  );

  // double-check that the owner is marked as having visual changesets
  if (owner) {
    await owner.setHasVisualChangesets(true);
  }

  const updatedVisualChangeset: VisualChangesetInterface = {
    ...visualChangeset,
    ...(safeUpdates.editorUrl !== undefined
      ? { editorUrl: safeUpdates.editorUrl }
      : {}),
    ...(safeUpdates.urlPatterns !== undefined
      ? { urlPatterns: safeUpdates.urlPatterns }
      : {}),
    visualChanges,
  };

  await onVisualChangesetUpdate({
    oldVisualChangeset: visualChangeset,
    newVisualChangeset: updatedVisualChangeset,
    owner,
    bypassWebhooks,
  });

  return { nModified: res.modifiedCount, visualChanges };
};

const onVisualChangesetCreate = async ({
  visualChangeset,
  owner,
}: {
  visualChangeset: VisualChangesetInterface;
  owner: ChangesetOwner;
}) => {
  if (!hasVisualChanges(visualChangeset.visualChanges)) return;
  await owner.refreshPayloads("created", visualChangeset.id);
};

const onVisualChangesetUpdate = async ({
  oldVisualChangeset,
  newVisualChangeset,
  owner,
  bypassWebhooks = false,
}: {
  oldVisualChangeset: VisualChangesetInterface;
  newVisualChangeset: VisualChangesetInterface;
  owner: ChangesetOwner | null;
  bypassWebhooks?: boolean;
}) => {
  if (bypassWebhooks) return;

  if (!visualChangesetsHaveChanges({ oldVisualChangeset, newVisualChangeset }))
    return;

  if (!owner) return;
  await owner.refreshPayloads("updated", newVisualChangeset.id);
};

const onVisualChangesetDelete = async ({
  visualChangeset,
  owner,
}: {
  visualChangeset: VisualChangesetInterface;
  owner: ChangesetOwner | null;
}) => {
  // if there were no visual changes before deleting, return early
  if (!hasVisualChanges(visualChangeset.visualChanges)) return;

  if (!owner) return;
  await owner.refreshPayloads("deleted", visualChangeset.id);
};

// when an experiment adds/removes variations, we need to update the analogous
// visual changes to be in sync
export const syncVisualChangesWithVariations = async ({
  owner,
  variations,
  context,
  visualChangeset,
}: {
  owner: ChangesetOwner | null;
  variations: Pick<OwnerVariation, "id">[];
  context: ReqContext | ApiReqContext;
  visualChangeset: VisualChangesetInterface;
}) => {
  const { visualChanges } = visualChangeset;
  const visualChangesByVariationId = keyBy(visualChanges, "variation");
  const newVisualChanges = variations.map((variation) => {
    const visualChange = visualChangesByVariationId[variation.id];
    return visualChange ? visualChange : genNewVisualChange(variation);
  });

  const unchanged =
    newVisualChanges.length === visualChanges.length &&
    newVisualChanges.every((vc, i) => vc === visualChanges[i]);
  if (unchanged) return;

  await updateVisualChangeset({
    context,
    visualChangeset: visualChangeset,
    owner,
    updates: { visualChanges: newVisualChanges },
    // bypass webhooks since we are only creating new (empty) visual changes
    bypassWebhooks: true,
  });
};

export const deleteVisualChangesetById = async ({
  visualChangeset,
  owner,
  context,
}: {
  visualChangeset: VisualChangesetInterface;
  owner: ChangesetOwner | null;
  context: ReqContext | ApiReqContext;
}) => {
  await VisualChangesetModel.deleteOne({
    id: visualChangeset.id,
    organization: context.org.id,
  });

  // if the owner has no more visual changesets, clear its flag
  if (owner) {
    const remaining = await findVisualChangesetsByExperiment(
      owner.id,
      context.org.id,
    );
    if (remaining.length === 0) {
      await owner.setHasVisualChangesets(false);
    }
  }

  await onVisualChangesetDelete({
    visualChangeset,
    owner,
  });
};
