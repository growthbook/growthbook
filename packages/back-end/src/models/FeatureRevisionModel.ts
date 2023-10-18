import mongoose from "mongoose";
import omit from "lodash/omit";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import { FeatureRevisionInterface } from "../../types/feature-revision";
import { EventAuditUser, EventAuditUserLoggedIn } from "../events/event-types";

const featureRevisionSchema = new mongoose.Schema({
  organization: String,
  featureId: String,
  createdBy: {},
  version: Number,
  baseVersion: Number,
  dateCreated: Date,
  dateUpdated: Date,
  datePublished: Date,
  publishedBy: {},
  comment: String,
  defaultValue: String,
  rules: {},
  status: String,
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

function toInterface(doc: FeatureRevisionDocument): FeatureRevisionInterface {
  const revision = omit(doc.toJSON<FeatureRevisionDocument>(), ["__v", "_id"]);

  // These fields are new, so backfill them for old revisions
  if (revision.publishedBy && !revision.publishedBy.type) {
    (revision.publishedBy as EventAuditUserLoggedIn).type = "dashboard";
  }
  if (!revision.status) revision.status = "published";
  if (!revision.createdBy)
    revision.createdBy = revision.publishedBy || {
      type: "dashboard",
      email: "",
      id: "",
      name: "",
    };
  if (!revision.baseVersion) revision.baseVersion = revision.version - 1;
  if (!revision.dateUpdated) revision.dateUpdated = revision.dateCreated;
  if (!revision.datePublished) {
    revision.datePublished =
      (revision as FeatureRevisionInterface & { revisionDate?: Date })
        .revisionDate || revision.dateCreated;
  }

  return revision;
}

export async function getRevisions(
  organization: string,
  featureId: string
): Promise<FeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
  });
  return docs.map(toInterface);
}

export async function getRevision(
  organization: string,
  featureId: string,
  version: number
) {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version,
  });

  return doc ? toInterface(doc) : null;
}

export async function createInitialRevision(
  feature: FeatureInterface,
  user: EventAuditUser
) {
  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    version: 1,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: new Date(),
    createdBy: user,
    baseVersion: 0,
    status: "published",
    publishedBy: user,
    comment: "",
    defaultValue: feature.defaultValue,
    rules,
  });
}

export async function createRevision(
  feature: FeatureInterface,
  user: EventAuditUser
) {
  // Get max version number
  const lastRevision = (
    await FeatureRevisionModel.find({
      organization: feature.organization,
      featureId: feature.id,
    })
      .sort({ version: -1 })
      .limit(1)
  )[0];
  const newVersion = lastRevision ? lastRevision.version + 1 : 1;

  const rules: Record<string, FeatureRule[]> = {};
  Object.keys(feature.environmentSettings || {}).forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  const doc = await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    version: newVersion,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: null,
    createdBy: user,
    baseVersion: feature.version,
    status: "draft",
    publishedBy: null,
    comment: "",
    defaultValue: feature.defaultValue,
    rules,
  });

  return toInterface(doc);
}

export async function updateRevision(
  revision: FeatureRevisionInterface,
  changes: Partial<
    Pick<FeatureRevisionInterface, "comment" | "defaultValue" | "rules">
  >
) {
  if (revision.status !== "draft") {
    throw new Error("Can only update draft revisions");
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { ...changes, dateUpdated: new Date() },
    }
  );
}

export async function markRevisionAsPublished(
  revision: FeatureRevisionInterface,
  user: EventAuditUser
) {
  if (revision.status !== "draft") {
    throw new Error("Can only publish draft revisions");
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        status: "published",
        publishedBy: user,
        datePublished: new Date(),
        dateUpdated: new Date(),
      },
    }
  );
}

export async function discardRevision(revision: FeatureRevisionInterface) {
  if (revision.status !== "draft") {
    throw new Error("Can only discard draft revisions");
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { status: "discarded", dateUpdated: new Date() },
    }
  );
}
