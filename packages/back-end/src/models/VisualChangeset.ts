import mongoose from "mongoose";
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
