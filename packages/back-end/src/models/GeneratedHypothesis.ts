import { omit } from "lodash";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ReqContext } from "back-end/types/request";
import { GeneratedHypothesisInterface } from "back-end/types/generated-hypothesis";
import { ExperimentInterface } from "back-end/types/experiment";
import { createExperiment } from "./ExperimentModel";
import { upsertWatch } from "./WatchModel";
import { createVisualChangeset } from "./VisualChangesetModel";
import { createFeature } from "./FeatureModel";

type GeneratedHypothesisDocument = mongoose.Document &
  GeneratedHypothesisInterface;

const generatedHypothesisSchema = new mongoose.Schema({
  id: String,
  weblensUuid: String,
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

generatedHypothesisSchema.index({ weblensUuid: 1 }, { unique: false });

const GeneratedHypothesisModel = mongoose.model<GeneratedHypothesisDocument>(
  "GeneratedHypothesis",
  generatedHypothesisSchema,
);

const toInterface = (
  doc: GeneratedHypothesisDocument,
): GeneratedHypothesisInterface =>
  omit(doc.toJSON<GeneratedHypothesisDocument>(), ["__v", "_id"]);

export const findOrCreateGeneratedHypothesis = async (
  context: ReqContext,
  uuid: string,
): Promise<GeneratedHypothesisInterface> => {
  const { org, userId } = context;
  const existing = await GeneratedHypothesisModel.findOne({
    weblensUuid: uuid,
    organization: context.org.id,
  });
  if (existing) return toInterface(existing);
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    throw new Error("Supabase keys missing");

  const res = await fetch(
    `${process.env.SUPABASE_URL}rest/v1/sites_hypotheses?select=*,...sites_dom_mutations(sdk_payload)&uuid=eq.${uuid}&limit=1`,
    {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY, // public-facing key
      },
    },
  );

  const rows = await res.json();

  if (!rows || !rows.length) {
    throw new Error(`Generated hypothesis not found: ${uuid}`);
  }

  const {
    hypothesis: { slug, oneLineSummary, hypothesis, control, variant },
    site_url,
    sdk_payload,
  } = rows[0];

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
  const payload = sdk_payload?.experiments?.[0];
  if (
    payload?.urlPatterns &&
    payload?.targetUrl &&
    payload?.variations?.[0]?.domMutations
  ) {
    // visual change
    await createVisualChangeset({
      experiment: createdExperiment,
      context,
      urlPatterns: payload?.urlPatterns,
      editorUrl: payload?.targetUrl,
      visualChanges: [
        {
          description: "",
          id: uniqid("vc_"),
          css: "",
          js: "",
          domMutations: payload?.variations[0].domMutations,
          variation: createdExperiment.variations[0].id,
        },
        {
          description: "",
          id: uniqid("vc_"),
          css: "",
          js: "",
          domMutations: payload?.variations[1].domMutations,
          variation: createdExperiment.variations[1].id,
        },
      ],
    });
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

  // link hypothesis to experiment
  const created = await GeneratedHypothesisModel.create({
    id: uniqid("genhyp_"),
    weblensUuid: uuid,
    createdAt: new Date(),
    organization: context.org.id,
    url: site_url,
    hypothesis,
    experiment: createdExperiment.id,
  });

  return toInterface(created);
};
