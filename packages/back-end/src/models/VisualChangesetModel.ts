import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ExperimentInterface } from "../../types/experiment";
import { ApiVisualChangeset } from "../../types/openapi";
import {
  VisualChange,
  VisualChangesetInterface,
} from "../../types/visual-changeset";

/**
 * VisualChangeset is a collection of visual changes that are grouped together
 * by a single url target. They are many-to-one with Experiments.
 */
const visualChangesetSchema = new mongoose.Schema({
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
    type: [String],
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
        id: {
          type: String,
          required: true,
        },
        description: String,
        css: String,
        variation: {
          type: String,
          index: true,
          required: true,
        },
        domMutations: [
          {
            selector: { type: String, required: true },
            action: {
              type: String,
              enum: ["append", "set", "remove"],
              required: true,
            },
            attribute: { type: String, required: true },
            value: String,
          },
        ],
      },
    ],
    required: true,
  },
});

export type VisualChangesetDocument = mongoose.Document &
  VisualChangesetInterface;

export const VisualChangesetModel = mongoose.model<VisualChangesetDocument>(
  "VisualChangeset",
  visualChangesetSchema
);

const toInterface = (doc: VisualChangesetDocument): VisualChangesetInterface =>
  omit(doc.toJSON(), ["__v", "_id"]);

export function toVisualChangesetApiInterface(
  visualChangeset: VisualChangesetInterface
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
      variation: c.variation,
      domMutations: c.domMutations,
    })),
  };
}

export async function findVisualChangesetById(
  id: string,
  organization: string
): Promise<VisualChangesetInterface | null> {
  const visualChangeset = await VisualChangesetModel.findOne({
    organization,
    id,
  });
  return visualChangeset ? toInterface(visualChangeset) : null;
}

export async function findVisualChangesetsByExperiment(
  experiment: string,
  organization: string
): Promise<VisualChangesetInterface[]> {
  const visualChangesets = await VisualChangesetModel.find({
    experiment,
    organization,
  });
  return visualChangesets.map(toInterface);
}

export async function createVisualChange(
  id: string,
  organization: string,
  visualChange: VisualChange
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
    }
  );

  return { nModified: res.nModified };
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
  payload: VisualChange;
}): Promise<{ nModified: number }> {
  const visualChangeset = await VisualChangesetModel.findOne({
    id: changesetId,
    organization,
  });

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
    }
  );

  return { nModified: res.nModified };
}

// TODO On creating a variation, we need to create a visual change for each
export const createVisualChangeset = async ({
  experiment,
  organization,
  urlPatterns,
  editorUrl,
}: {
  experiment: ExperimentInterface;
  organization: string;
  urlPatterns: string[];
  editorUrl: string;
}): Promise<VisualChangesetInterface> => {
  const visualChangeset = await VisualChangesetModel.create({
    id: uniqid("vcs_"),
    experiment: experiment.id,
    organization,
    urlPatterns,
    editorUrl,
    visualChanges: experiment.variations.map((variation) => ({
      id: uniqid("vc_"),
      variation: variation.id,
      description: "",
      css: "",
      domMutations: [],
    })),
  });
  return toInterface(visualChangeset);
};
