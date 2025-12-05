import { keyBy } from "lodash";
import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { hasVisualChanges } from "shared/util";
import {
  VisualChange,
  VisualChangesetInterface,
  VisualChangesetURLPattern,
} from "shared/types/visual-changeset";
import { ExperimentInterface, Variation } from "back-end/types/experiment";
import { ApiVisualChangeset } from "back-end/types/openapi";
import { ReqContext } from "back-end/types/organization";
import { refreshSDKPayloadCache } from "back-end/src/services/features";
import { visualChangesetsHaveChanges } from "back-end/src/services/experiments";
import { ApiReqContext } from "back-end/types/api";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "./ExperimentModel";

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

export async function findVisualChangesets(
  organization: string,
): Promise<VisualChangesetInterface[]> {
  return (
    await VisualChangesetModel.find({
      organization,
    })
  ).map(toInterface);
}

export async function createVisualChange(
  id: string,
  organization: string,
  visualChange: VisualChange,
): Promise<{ nModified: number }> {
  const visualChangeset = await VisualChangesetModel.findOne({
    id,
    organization,
  });

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const res = await VisualChangesetModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: {
        visualChanges: [...visualChangeset.visualChanges, visualChange],
      },
    },
  );

  return { nModified: res.modifiedCount };
}

export async function updateVisualChange({
  changesetId,
  visualChangeId,
  organization,
  payload,
}: {
  changesetId: string;
  visualChangeId: string;
  organization: string;
  payload: Partial<VisualChange>;
}): Promise<{ nModified: number }> {
  const visualChangeset = await findVisualChangesetById(
    changesetId,
    organization,
  );

  if (!visualChangeset) {
    throw new Error("Visual Changeset not found");
  }

  const visualChanges = visualChangeset.visualChanges.map((visualChange) => {
    if (visualChange.id === visualChangeId) {
      return {
        ...visualChange,
        ...payload,
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

  return { nModified: res.modifiedCount };
}

export const genNewVisualChange = (variation: Variation): VisualChange => ({
  id: uniqid("vc_"),
  variation: variation.id,
  description: "",
  css: "",
  domMutations: [],
});

export const createVisualChangeset = async ({
  experiment,
  context,
  urlPatterns,
  editorUrl,
  visualChanges,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  urlPatterns: VisualChangesetURLPattern[];
  editorUrl: VisualChangesetInterface["editorUrl"];
  visualChanges?: VisualChange[];
}): Promise<VisualChangesetInterface> => {
  const visualChangeset = toInterface(
    await VisualChangesetModel.create({
      id: uniqid("vcs_"),
      experiment: experiment.id,
      organization: context.org.id,
      urlPatterns,
      editorUrl,
      visualChanges:
        visualChanges || experiment.variations.map(genNewVisualChange),
    }),
  );

  // mark the experiment as having a visual changeset
  if (!experiment.hasVisualChangesets) {
    experiment = await updateExperiment({
      context,
      experiment,
      changes: { hasVisualChangesets: true },
      bypassWebhooks: true,
    });
  }

  await onVisualChangesetCreate({
    context,
    visualChangeset,
    experiment,
  });

  return visualChangeset;
};

// type guard
const _isUpdatingVisualChanges = (
  updates: Partial<VisualChangesetInterface>,
): updates is {
  visualChanges: VisualChange[];
} & Partial<VisualChangesetInterface> =>
  updates.visualChanges !== undefined && updates.visualChanges.length > 0;

export const updateVisualChangeset = async ({
  visualChangeset,
  experiment,
  context,
  updates,
  bypassWebhooks,
}: {
  visualChangeset: VisualChangesetInterface;
  experiment: ExperimentInterface | null;
  context: ReqContext | ApiReqContext;
  updates: Partial<VisualChangesetInterface>;
  bypassWebhooks?: boolean;
}) => {
  const isUpdatingVisualChanges = _isUpdatingVisualChanges(updates);

  // ensure new visual changes have ids assigned
  const visualChanges = isUpdatingVisualChanges
    ? updates.visualChanges.map((vc) => ({
        ...vc,
        id: vc.id || uniqid("vc_"),
      }))
    : visualChangeset.visualChanges || [];

  const res = await VisualChangesetModel.updateOne(
    {
      id: visualChangeset.id,
      organization: context.org.id,
    },
    {
      $set: {
        ...updates,
        visualChanges,
      },
    },
  );

  // double-check that the experiment is marked as having visual changesets
  if (experiment && !experiment.hasVisualChangesets) {
    await updateExperiment({
      context,
      experiment,
      changes: { hasVisualChangesets: true },
      bypassWebhooks: true,
    });
  }

  await onVisualChangesetUpdate({
    oldVisualChangeset: visualChangeset,
    newVisualChangeset: {
      ...visualChangeset,
      ...updates,
      visualChanges,
    },
    context,
    bypassWebhooks,
  });

  return { nModified: res.modifiedCount, visualChanges };
};

const onVisualChangesetCreate = async ({
  context,
  visualChangeset,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  visualChangeset: VisualChangesetInterface;
  experiment: ExperimentInterface;
}) => {
  if (!hasVisualChanges(visualChangeset.visualChanges)) return;

  const payloadKeys = getPayloadKeys(context, experiment);

  await refreshSDKPayloadCache(context, payloadKeys);
};

const onVisualChangesetUpdate = async ({
  context,
  oldVisualChangeset,
  newVisualChangeset,
  bypassWebhooks = false,
}: {
  context: ReqContext | ApiReqContext;
  oldVisualChangeset: VisualChangesetInterface;
  newVisualChangeset: VisualChangesetInterface;
  bypassWebhooks?: boolean;
}) => {
  if (bypassWebhooks) return;

  if (!visualChangesetsHaveChanges({ oldVisualChangeset, newVisualChangeset }))
    return;

  const experiment = await getExperimentById(
    context,
    newVisualChangeset.experiment,
  );

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(context, experiment);

  await refreshSDKPayloadCache(context, payloadKeys);
};

const onVisualChangesetDelete = async ({
  context,
  visualChangeset,
}: {
  context: ReqContext | ApiReqContext;
  visualChangeset: VisualChangesetInterface;
}) => {
  // if there were no visual changes before deleting, return early
  if (!hasVisualChanges(visualChangeset.visualChanges)) return;

  // get payload keys
  const experiment = await getExperimentById(
    context,
    visualChangeset.experiment,
  );

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(context, experiment);

  await refreshSDKPayloadCache(context, payloadKeys);
};

// when an experiment adds/removes variations, we need to update the analogous
// visual changes to be in sync
export const syncVisualChangesWithVariations = async ({
  experiment,
  context,
  visualChangeset,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  visualChangeset: VisualChangesetInterface;
}) => {
  const { variations } = experiment;
  const { visualChanges } = visualChangeset;
  const visualChangesByVariationId = keyBy(visualChanges, "variation");
  const newVisualChanges = variations.map((variation) => {
    const visualChange = visualChangesByVariationId[variation.id];
    return visualChange ? visualChange : genNewVisualChange(variation);
  });

  await updateVisualChangeset({
    context,
    visualChangeset: visualChangeset,
    experiment,
    updates: { visualChanges: newVisualChanges },
    // bypass webhooks since we are only creating new (empty) visual changes
    bypassWebhooks: true,
  });
};

export const deleteVisualChangesetById = async ({
  visualChangeset,
  experiment,
  context,
}: {
  visualChangeset: VisualChangesetInterface;
  experiment: ExperimentInterface | null;
  context: ReqContext | ApiReqContext;
}) => {
  await VisualChangesetModel.deleteOne({
    id: visualChangeset.id,
    organization: context.org.id,
  });

  // if experiment has no more visual changesets, update experiment
  const remainingVisualChangesets = await findVisualChangesetsByExperiment(
    visualChangeset.experiment,
    context.org.id,
  );
  if (remainingVisualChangesets.length === 0) {
    if (experiment && experiment.hasVisualChangesets) {
      await updateExperiment({
        context,
        experiment,
        changes: { hasVisualChangesets: false },
        bypassWebhooks: true,
      });
    }
  }

  await onVisualChangesetDelete({
    context,
    visualChangeset,
  });
};

export const findExperimentByVisualChangesetId = async (
  context: ReqContext | ApiReqContext,
  visualChangesetId: string,
): Promise<ExperimentInterface | null> => {
  const visualChangeset = await findVisualChangesetById(
    visualChangesetId,
    context.org.id,
  );

  if (!visualChangeset) return null;

  return getExperimentById(context, visualChangeset.experiment);
};
