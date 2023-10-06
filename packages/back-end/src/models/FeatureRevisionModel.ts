import { randomUUID } from "crypto";
import mongoose from "mongoose";
import omit from "lodash/omit";
import {
  FeatureDraftChanges,
  FeatureInterface,
  FeatureRule,
} from "../../types/feature";
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
    enum: ["published", "draft", "discarded"],
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

export async function getDraftFeatureRevisions(
  organization: string,
  featureId: string
): Promise<FeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
    status: {
      $in: ["draft", "discarded"],
    },
  });
  return docs.map(toInterface);
}

type SaveRevisionParams = {
  state: "published" | "draft";
  feature: FeatureInterface;
  creatorUserId: string | null;
  comment?: string;
};

export async function createFeatureRevision({
  feature,
  creatorUserId,
  state,
  comment,
}: SaveRevisionParams): Promise<FeatureRevisionInterface | null> {
  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  let versionNumber = 2;

  const latestRevision = await FeatureRevisionModel.findOne(
    {
      organization: feature.organization,
      featureId: feature.id,
    },
    null,
    {
      sort: { dateCreated: -1 },
      limit: 1,
    }
  );

  if (latestRevision) {
    versionNumber = latestRevision.version + 1;
  }

  try {
    const doc = await FeatureRevisionModel.create({
      id: `feat-rev_${randomUUID()}`,
      organization: feature.organization,
      featureId: feature.id,
      creatorUserId,
      version: versionNumber,
      dateCreated: new Date(),
      revisionDate: feature.revision?.date || feature.dateCreated,
      status: state,
      publishedBy:
        state === "draft"
          ? null
          : feature.revision?.publishedBy || {
              id: "",
              email: "",
              name: "",
            },
      comment: comment || feature.revision?.comment || "",
      defaultValue: feature.defaultValue,
      rules,
    });

    return toInterface(doc);
  } catch (e) {
    // The most likely error is a duplicate key error from the revision version
    // This is not a fatal error and should not stop the feature from being created
    logger.error(e, "Error saving feature revision");

    return null;

    // TODO: handle duplicate key errors more elegantly
  }
}

export async function updateDraftFeatureRevision({
  creatorUserId,
  organizationId,
  featureId,
  id,
  draft,
}: {
  organizationId: string;
  featureId: string;
  creatorUserId?: string;
  id: string;
  draft: Partial<
    Pick<FeatureDraftChanges, "comment" | "rules" | "defaultValue">
  >;
}): Promise<void> {
  const { rules, comment, defaultValue } = draft;

  await FeatureRevisionModel.updateOne(
    {
      id,
      organization: organizationId,
      creatorUserId,
      featureId,
      dateDiscarded: null,
      status: "draft",
    },
    {
      $set: {
        rules,
        comment,
        defaultValue,
      },
    }
  );
}

export async function getFeatureRevision({
  organizationId,
  featureId,
  id,
  status,
}: {
  organizationId: string;
  featureId: string;
  id: string;
  status?: "draft" | "published" | "discarded";
}): Promise<FeatureRevisionInterface> {
  const doc = await FeatureRevisionModel.findOne({
    id,
    organization: organizationId,
    featureId,
    status,
  });

  if (!doc) {
    throw new Error(
      `FeatureRevision not found: ${JSON.stringify({
        organizationId,
        featureId,
        status,
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
      status: "draft",
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

/**
 * finds the draft revision for the provided search criteria and marks it as discarded
 * @param organizationId
 * @param featureId
 * @param revisionId
 */
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
        status: "discarded",
      },
    }
  );
}
