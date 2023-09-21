import { randomUUID } from "crypto";
import mongoose from "mongoose";
import omit from "lodash/omit";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { logger } from "../util/logger";

const featureRevisionSchema = new mongoose.Schema({
  id: String,
  organization: String,
  featureId: String,
  version: Number,
  dateCreated: Date,
  dateUpdated: {
    type: Date,
    required: false,
  },
  dateDiscarded: {
    type: Date,
    required: false,
  },
  revisionDate: Date,
  publishedBy: {},
  comment: String,
  defaultValue: String,
  rules: {},
  creatorUserId: {
    type: String,
    required: false,
  },
  status: {
    type: String,
    required: false,
    enum: ["published", "draft"], // todo: everything with these
  },
  baseVersion: {
    type: String,
    required: false,
  },
});

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true }
);

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema
);

const toInterface = (
  doc: FeatureRevisionDocument
): FeatureRevisionInterface => {
  const json = omit(doc.toJSON<FeatureRevisionDocument>(), ["__v", "_id"]);

  const withDefaults = {
    ...json,
    // `status` is a new fields. previously, all feature revisions were published
    status: json.status || "published",
  };

  return withDefaults;
};

export async function getPublishedFeatureRevisions(
  organization: string,
  featureId: string
): Promise<FeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
    status: {
      $in: [null, "published"],
    },
    dateDiscarded: null,
  });
  return docs.map(toInterface);
}

type SaveRevisionParams = {
  state: "published" | "draft";
  feature: FeatureInterface;
  creatorUserId: string | null;
};

export async function createFeatureRevision({
  feature,
  creatorUserId,
  state,
}: SaveRevisionParams): Promise<void> {
  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  try {
    await FeatureRevisionModel.create({
      id: `feat-rev_${randomUUID()}`,
      organization: feature.organization,
      featureId: feature.id,
      creatorUserId,
      version: feature.revision?.version || 1,
      dateCreated: new Date(),
      revisionDate: feature.revision?.date || feature.dateCreated,
      state,
      publishedBy:
        state === "draft"
          ? null
          : feature.revision?.publishedBy || {
              id: "",
              email: "",
              name: "",
            },
      comment: feature.revision?.comment || "",
      defaultValue: feature.defaultValue,
      rules,
    });
  } catch (e) {
    // The most likely error is a duplicate key error from the revision version
    // This is not a fatal error and should not stop the feature from being created
    logger.error(e, "Error saving feature revision");

    // TODO: handle duplicate key errors more elegantly
  }
}

export async function getFeatureRevision({
  organizationId,
  featureId,
  id,
}: {
  organizationId: string;
  featureId: string;
  id: string;
}): Promise<FeatureRevisionInterface> {
  const doc = await FeatureRevisionModel.findOne({
    id,
    organization: organizationId,
    featureId,
    dateDiscarded: null,
  });

  if (!doc) {
    throw new Error(
      `FeatureRevision not found: ${JSON.stringify({
        organizationId,
        featureId,
        id,
      })}`
    );
  }

  return toInterface(doc);
}

export async function publishFeatureRevision({
  organizationId,
  featureId,
  revisionId,
  user: { id, email, name },
}: {
  organizationId: string;
  featureId: string;
  revisionId: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}): Promise<void> {
  await FeatureRevisionModel.updateOne(
    {
      id: revisionId,
      organization: organizationId,
      featureId,
      dateDiscarded: null,
    },
    {
      $set: {
        publishedBy: {
          id,
          email,
          name,
        },
        status: "published",
      },
    }
  );
}

export async function discardDraftFeatureRevision({
  organizationId,
  featureId,
  revisionId,
}: {
  organizationId: string;
  featureId: string;
  revisionId: string;
}): Promise<void> {
  await FeatureRevisionModel.updateOne(
    {
      id: revisionId,
      organization: organizationId,
      featureId,
      dateDiscarded: null,
      status: "draft",
    },
    {
      $set: {
        dateDiscarded: new Date(),
      },
    }
  );
}
