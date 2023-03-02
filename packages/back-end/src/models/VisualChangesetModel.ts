import omit from "lodash/omit";
import mongoose from "mongoose";
import { ApiVisualChangeset } from "../../types/openapi";
import { VisualChangesetInterface } from "../../types/visual-changeset";

/**
 * VisualChangeset is a collection of visual changes that are grouped together
 * by a single url target. They are many-to-one with Experiments.
 */
const visualChangesetSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  urlPattern: String,
  editorUrl: String,
  experiment: {
    type: String,
    index: true,
  },
  // VisualChanges are associated with one of the variations of the experiment
  // associated with the VisualChangeset
  visualChanges: [
    {
      id: String,
      description: String,
      css: String,
      variation: {
        type: String,
        index: true,
      },
      domMutations: [
        {
          selector: String,
          action: ["append", "set", "remove"],
          attribute: String,
          value: String,
        },
      ],
    },
  ],
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
    urlPattern: visualChangeset.urlPattern,
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
) {
  const visualChangeset = await VisualChangesetModel.findOne({
    organization,
    id,
  });
  return visualChangeset ? toInterface(visualChangeset) : null;
}

export async function findVisualChangesetsByOrganization(organization: string) {
  const visualChangesets = await VisualChangesetModel.find({
    organization,
  });
  return visualChangesets.map(toInterface);
}
