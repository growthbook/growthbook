import mongoose from "mongoose";
// import uniqid from "uniqid";
import { omit } from "lodash";
import { FeatureCodeRefsInterface } from "../../types/code-refs";

const featureCodeRefsSchema = new mongoose.Schema({
  id: String,
  organization: String,
  dateUpdated: Date,
  feature: String,
  repo: String,
  branch: String,
  platform: {
    type: String,
    enum: ["github", "gitlab", "bitbucket"],
    default: "github",
  },
  // TODO rename to refs
  codeRefs: [
    {
      filePath: String,
      startingLineNumber: Number,
      lines: String,
      flagKey: String,
    },
  ],
});

featureCodeRefsSchema.index(
  { id: 1, organizatiion: 1, repo: 1, feature: 1 },
  { unique: true }
);

type FeatureCodeRefsDocument = mongoose.Document & FeatureCodeRefsInterface;

const FeatureCodeRefsModel = mongoose.model<FeatureCodeRefsInterface>(
  "FeatureCodeRefs",
  featureCodeRefsSchema
);

function toInterface(doc: FeatureCodeRefsDocument): FeatureCodeRefsInterface {
  const ret = doc.toJSON<FeatureCodeRefsDocument>();
  return omit(ret, ["__v", "_id"]);
}

// TODO add org to query
export const upsertFeatureCodeRefs = async ({
  feature,
  repo,
  branch,
  platform = "github",
  codeRefs,
}: {
  feature: string;
  repo: string;
  branch: string;
  platform: "github" | "gitlab" | "bitbucket";
  codeRefs: FeatureCodeRefsInterface["codeRefs"];
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!feature || !repo || !branch || !platform || !codeRefs) {
    // eslint-disable-next-line no-console
    console.error("Missing required params", {
      feature,
      repo,
      branch,
      platform,
      codeRefs,
    });
    throw new Error("Missing required parameters");
  }

  await FeatureCodeRefsModel.updateMany(
    {
      feature,
      repo,
      branch,
    },
    {
      codeRefs,
      dateUpdated: new Date(),
    },
    { upsert: true }
  );

  return await FeatureCodeRefsModel.find({
    feature,
    repo,
    branch,
  }).then((docs) => docs.map(toInterface));
};

// TODO add org to query
export const getAllFeatureCodeRefs = async ({
  repo,
  branch,
  platform = "github",
}: {
  repo: string;
  branch: string;
  platform: "github" | "gitlab" | "bitbucket";
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!repo || !branch || !platform) {
    throw new Error("Missing required parameters");
  }

  return await FeatureCodeRefsModel.find({
    repo,
    branch,
  }).then((docs) => docs.map(toInterface));
};

export const getCodeRefsForFeature = async ({
  feature,
}: {
  feature: string;
}): Promise<FeatureCodeRefsInterface[]> => {
  if (!feature) {
    throw new Error("Missing required parameters");
  }

  return await FeatureCodeRefsModel.find({
    feature,
  }).then((docs) => docs.map(toInterface));
};
