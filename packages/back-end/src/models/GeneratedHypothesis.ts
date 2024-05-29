import { omit } from "lodash";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { createClient } from "@supabase/supabase-js";
import { ReqContext } from "@back-end/types/organization";
import { GeneratedHypothesisInterface } from "@back-end/types/generated-hypothesis";
import { getExperimentById } from "./ExperimentModel";

type GeneratedHypothesisDocument = mongoose.Document &
  GeneratedHypothesisInterface;

const generatedHypothesisSchema = new mongoose.Schema({
  id: String,
  uuid: String,
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

generatedHypothesisSchema.index({ uuid: 1 }, { unique: true });

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
  uuid: string
): Promise<GeneratedHypothesisInterface> => {
  const existing = await GeneratedHypothesisModel.findOne({
    uuid,
  });
  if (existing) return toInterface(existing);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error("Supabase keys missing");
  }
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data: generatedHypothesis, error: payloadErr } = await supabase
    .from("hypotheses")
    .select()
    .eq("uuid", uuid)
    .single();
  if (payloadErr) throw new Error(payloadErr.message);
  const created = await GeneratedHypothesisModel.create({
    id: uniqid("genhyp_"),
    uuid,
    createdAt: new Date(),
    organization: context.org.id,
    url: generatedHypothesis.url,
    hypothesis: generatedHypothesis.hypothesis,
    payload: generatedHypothesis.translated_payload,
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

export const getGeneratedHypothesisById = async (
  context: ReqContext,
  id: string
) => {
  return await GeneratedHypothesisModel.findOne({
    id,
    organization: context.org.id,
  });
};
