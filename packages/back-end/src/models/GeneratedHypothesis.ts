import { omit } from "lodash";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ReqContext } from "@back-end/types/organization";
import { GeneratedHypothesisInterface } from "@back-end/types/generated-hypothesis";
import { getExperimentById } from "./ExperimentModel";

type GeneratedHypothesisDocument = mongoose.Document &
  GeneratedHypothesisInterface;

const generatedHypothesisSchema = new mongoose.Schema({
  id: String,
  hypothesisUuid: String,
  createdAt: Date,
  organization: String,
  url: String,
  hypothesis: String,
  payload: {},
  experiment: {
    type: String,
    index: true,
    require: false,
  },
});

generatedHypothesisSchema.index({ hypothesisUuid: 1 }, { unique: true });

const GeneratedHypothesisModel = mongoose.model<GeneratedHypothesisDocument>(
  "GeneratedHypothesis",
  generatedHypothesisSchema
);

const toInterface = (
  doc: GeneratedHypothesisDocument
): GeneratedHypothesisInterface =>
  omit(doc.toJSON<GeneratedHypothesisDocument>(), ["__v", "_id"]);

export const findOrCreateGeneratedHypothesis = async (
  context: ReqContext,
  hypothesisUuid: string
) => {
  const existing = await GeneratedHypothesisModel.findOne({
    hypothesisUuid,
  });
  if (existing) return toInterface(existing);
  // TODO fetch hypothesis from supabase
  // placeholder
  const generatedHypothesis = {
    id: 32,
    uuid: "ae68795d-9d2d-4b6e-ba3b-53950f69de03",
    created_at: "2024-05-28 18:33:31.010623+00",
    url: "https://www.statsig.com",
    hypothesis: `Adding a short explainer video demonstrating the product's key features and benefits will increase user engagement.`,
    payload: {
      experiments: [
        {
          key: "abc123",
          weights: [0.5, 0.5],
          targetUrl: "https://www.statsig.com",
          hypothesis:
            "Adding a short explainer video demonstrating the product's key features and benefits will increase user engagement.",
          variations: [
            { domMutations: [] },
            {
              domMutations: [
                {
                  value:
                    '<video width="320" height="240" controls><source src="https://example.com/explainer_video.mp4" type="video/mp4">Your browser does not support the video tag.</video>',
                  action: "append",
                  selector: "div.subHeading",
                  attribute: "html",
                },
              ],
            },
          ],
          urlPatterns: [
            {
              type: "simple",
              include: true,
              pattern: "https://www.statsig.com/*",
            },
          ],
        },
      ],
    },
  };
  const created = await GeneratedHypothesisModel.create({
    id: uniqid("genhyp_"),
    hypothesisUuid,
    createdAt: new Date(),
    organization: context.org.id,
    url: generatedHypothesis.url,
    hypothesis: generatedHypothesis.hypothesis,
    payload: generatedHypothesis.payload,
  });
  return toInterface(created);
};

export const linkExperimentToHypothesis = async (
  context: ReqContext,
  hypothesisId: string,
  experimentId: string
) => {
  const existing = await GeneratedHypothesisModel.findOne({
    id: hypothesisId,
    organization: context.org.id,
  });
  if (!existing) throw new Error("Hypothesis not found");
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) throw new Error("Experiment not found");
  await GeneratedHypothesisModel.updateOne(
    {
      id: hypothesisId,
      organization: context.org.id,
    },
    {
      $set: {
        experiment: experiment.id,
      },
    }
  );
  const updated = await GeneratedHypothesisModel.findOne({
    id: hypothesisId,
    organization: context.org.id,
  });
  return updated;
};
