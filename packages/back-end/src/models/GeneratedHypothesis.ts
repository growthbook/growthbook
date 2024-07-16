import { omit } from "lodash";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { createClient } from "@supabase/supabase-js";
import { ReqContext } from "@back-end/types/organization";
import { GeneratedHypothesisInterface } from "@back-end/types/generated-hypothesis";
import { ExperimentInterface } from "@back-end/types/experiment";
import { createExperiment, getExperimentById } from "./ExperimentModel";
import { upsertWatch } from "./WatchModel";
import { createVisualChangeset } from "./VisualChangesetModel";
import { createFeature } from "./FeatureModel";

type GeneratedHypothesisDocument = mongoose.Document &
  GeneratedHypothesisInterface;

const generatedHypothesisSchema = new mongoose.Schema({
  id: String,
  uuid: String,
  createdAt: Date,
  organization: String,
  url: String,
  hypothesis: String,
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
  const { org, userId } = context;
  const existing = await GeneratedHypothesisModel.findOne({
    uuid,
  });
  if (existing) return toInterface(existing);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw new Error("Supabase keys missing");

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: siteHypothesis, error: siteHypErr } = await supabase
    .from("sites_hypotheses")
    .select("*, sites(url), sites_dom_mutations(sdk_payload)")
    .eq("uuid", uuid)
    .single();

  if (siteHypErr) throw new Error(siteHypErr.message);

  const {
    hypothesis: { slug, oneLineSummary, hypothesis, control, variant },
    sites: { url },
    sites_dom_mutations,
  } = siteHypothesis;
  const { sdk_payload } = sites_dom_mutations || {};

  const experimentToCreate: Pick<
    ExperimentInterface,
    | "name"
    | "owner"
    | "description"
    | "hypothesis"
    | "hashAttribute"
    | "status"
    | "trackingKey"
    | "variations"
    | "phases"
  > = {
    name: slug,
    owner: userId,
    description: oneLineSummary,
    hypothesis,
    hashAttribute: "id",
    status: "draft",
    trackingKey: slug,
    variations: [
      {
        name: "Control",
        description: control,
        key: "0",
        screenshots: [],
        id: uniqid("var_"),
      },
      {
        name: `Variation 1`,
        description: variant,
        key: "1",
        screenshots: [],
        id: uniqid("var_"),
      },
    ],
    phases: [
      {
        coverage: 1,
        dateStarted: new Date(),
        dateEnded: new Date(),
        name: "Main",
        reason: "",
        variationWeights: [0.5, 0.5],
        condition: "",
        namespace: { enabled: false, name: "", range: [0, 1] },
      },
    ],
  };

  const createdExperiment = await createExperiment({
    data: experimentToCreate,
    context,
  });

  await upsertWatch({
    userId,
    organization: org.id,
    item: createdExperiment.id,
    type: "experiments",
  });

  // create feature flag or visual change
  if (sdk_payload) {
    // visual change
    await createVisualChangeset({
      experiment: createdExperiment,
      context,
      urlPatterns: sdk_payload.urlPatterns,
      editorUrl: sdk_payload.targetUrl,
      visualChanges: [
        {
          description: "",
          id: uniqid("vc_"),
          css: "",
          js: "",
          domMutations: sdk_payload.variations[0].domMutations,
          variation: createdExperiment.variations[0].id,
        },
        {
          description: "",
          id: uniqid("vc_"),
          css: "",
          js: "",
          domMutations: sdk_payload.variations[1].domMutations,
          variation: createdExperiment.variations[1].id,
        },
      ],
    });
    // TODO enable pro trial if they are not already enabled
  } else {
    // linked feature flag
    const featureId = `${slug}-feature-flag`;
    await createFeature(context, {
      id: featureId,
      archived: false,
      description: `Feature flag for ${slug} experiment`,
      organization: org.id,
      owner: userId,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      hasDrafts: false,
      tags: [],
      environmentSettings: {
        production: {
          enabled: true,
          rules: [
            {
              id: uniqid("fr_"),
              experimentId: createdExperiment.id,
              enabled: true,
              description: "",
              variations: [
                {
                  variationId: createdExperiment.variations[0].id,
                  value: "false",
                },
                {
                  variationId: createdExperiment.variations[1].id,
                  value: "true",
                },
              ],
              type: "experiment-ref",
            },
          ],
        },
      },
      linkedExperiments: [createdExperiment.id],
    });
    await upsertWatch({
      userId,
      organization: org.id,
      item: featureId,
      type: "features",
    });
  }

  const created = await GeneratedHypothesisModel.create({
    id: uniqid("genhyp_"),
    uuid,
    createdAt: new Date(),
    organization: context.org.id,
    url,
    hypothesis,
    experiment: createdExperiment.id,
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
