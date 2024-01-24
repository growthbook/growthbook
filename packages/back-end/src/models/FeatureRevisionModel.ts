import mongoose from "mongoose";
import omit from "lodash/omit";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "../../types/feature-revision";
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
  log: [
    {
      _id: false,
      user: {},
      approvedBy: {},
      timestamp: Date,
      action: String,
      subject: String,
      value: String,
    },
  ],
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
  })
    .sort({ version: -1 })
    .limit(25);

  // Remove the log when fetching all revisions since it can be large to send over the network
  return docs.map(toInterface).map((d) => {
    delete d.log;
    return d;
  });
}

export async function hasDraft(
  organization: string,
  feature: FeatureInterface,
  excludeVersions: number[] = []
): Promise<boolean> {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId: feature.id,
    status: "draft",
    version: { $nin: excludeVersions },
  });

  return doc ? true : false;
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
  user: EventAuditUser | null,
  environments: string[],
  date?: Date
) {
  const rules: Record<string, FeatureRule[]> = {};
  environments.forEach((env) => {
    rules[env] = feature.environmentSettings?.[env]?.rules || [];
  });

  date = date || new Date();

  const doc = await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    version: 1,
    dateCreated: date,
    dateUpdated: date,
    datePublished: date,
    createdBy: user,
    baseVersion: 0,
    status: "published",
    publishedBy: user,
    comment: "",
    defaultValue: feature.defaultValue,
    rules,
  });

  return toInterface(doc);
}

export async function createRevisionFromLegacyDraft(feature: FeatureInterface) {
  if (!feature.legacyDraft) return;
  const doc = await FeatureRevisionModel.create(feature.legacyDraft);
  return toInterface(doc);
}

export async function createRevision({
  feature,
  user,
  environments,
  baseVersion,
  changes,
  publish,
  comment,
  requiresReview,
}: {
  feature: FeatureInterface;
  user: EventAuditUser;
  environments: string[];
  baseVersion?: number;
  changes?: Partial<FeatureRevisionInterface>;
  publish?: boolean;
  comment?: string;
  requiresReview?: boolean;
}) {
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

  const defaultValue =
    changes && "defaultValue" in changes
      ? changes.defaultValue
      : feature.defaultValue;

  const rules: Record<string, FeatureRule[]> = {};
  environments.forEach((env) => {
    if (changes && changes.rules) {
      rules[env] = changes.rules[env] || [];
    } else {
      rules[env] = feature.environmentSettings?.[env]?.rules || [];
    }
  });

  const log: RevisionLog = {
    action: "new revision",
    subject: `based on revision #${baseVersion || feature.version}`,
    timestamp: new Date(),
    user,
    value: JSON.stringify({
      status: publish ? "published" : "draft",
      comment: comment || "",
      defaultValue,
      rules,
    }),
  };
  let status = "draft";
  if (publish && !requiresReview) {
    status = "published";
  } else if (publish && requiresReview) {
    status = "pending-review";
  }
  const doc = await FeatureRevisionModel.create({
    organization: feature.organization,
    featureId: feature.id,
    version: newVersion,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: publish && requiresReview ? new Date() : null,
    createdBy: user,
    baseVersion: baseVersion || feature.version,
    status,
    publishedBy: publish && requiresReview ? user : null,
    comment: comment || "",
    defaultValue,
    rules,
    log: [log],
  });

  return toInterface(doc);
}

export async function updateRevision(
  revision: FeatureRevisionInterface,
  changes: Partial<
    Pick<
      FeatureRevisionInterface,
      "comment" | "defaultValue" | "rules" | "baseVersion"
    >
  >,
  log: Omit<RevisionLog, "timestamp">
) {
  // If editing defaultValue or rules, require the revision to be a draft
  if ("defaultValue" in changes || changes.rules) {
    if (
      !(
        revision.status === "draft" ||
        revision.status === "pending-review" ||
        revision.status === "reviewed"
      )
    ) {
      throw new Error("Can only update draft revisions");
    }
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { ...changes, dateUpdated: new Date() },
      $push: {
        log: {
          ...log,
          timestamp: new Date(),
        },
      },
    }
  );
}

export async function markRevisionAsPublished(
  revision: FeatureRevisionInterface,
  user: EventAuditUser,
  comment?: string
) {
  const action = revision.status === "draft" ? "publish" : "re-publish";

  const log: RevisionLog = {
    action,
    subject: "",
    timestamp: new Date(),
    user,
    value: JSON.stringify(comment ? { comment } : {}),
  };

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
        comment: comment ?? revision.comment,
      },
      $push: {
        log,
      },
    }
  );
}

export async function markRevisionAsReviewRequested(
  revision: FeatureRevisionInterface,
  user: EventAuditUser,
  comment?: string
) {
  const action = "pending-review";

  const log: RevisionLog = {
    action,
    subject: "",
    timestamp: new Date(),
    user,
    value: JSON.stringify(comment ? { comment } : {}),
  };

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: {
        status: "pending-review",
        publishedBy: user,
        datePublished: new Date(),
        dateUpdated: new Date(),
        comment: comment ?? revision.comment,
      },
      $push: {
        log,
      },
    }
  );
}

export async function discardRevision(
  revision: FeatureRevisionInterface,
  user: EventAuditUser
) {
  if (revision.status !== "draft") {
    throw new Error("Can only discard draft revisions");
  }

  const log: RevisionLog = {
    action: "discard",
    subject: "",
    timestamp: new Date(),
    user,
    value: JSON.stringify({}),
  };

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { status: "discarded", dateUpdated: new Date() },
      $push: {
        log,
      },
    }
  );
}

export async function getFeatureRevisionsByFeatureIds(
  organization: string,
  featureIds: string[]
): Promise<Record<string, FeatureRevisionInterface[]>> {
  const revisionsByFeatureId: Record<string, FeatureRevisionInterface[]> = {};

  if (featureIds.length) {
    const revisions = await FeatureRevisionModel.find({
      organization,
      featureId: { $in: featureIds },
    });
    revisions.forEach((revision) => {
      const featureId = revision.featureId;
      revisionsByFeatureId[featureId] = revisionsByFeatureId[featureId] || [];
      revisionsByFeatureId[featureId].push(toInterface(revision));
    });
  }

  return revisionsByFeatureId;
}

export async function deleteAllRevisionsForFeature(
  organization: string,
  featureId: string
) {
  await FeatureRevisionModel.deleteMany({
    organization,
    featureId,
  });
}

export async function cleanUpPreviousRevisions(
  organization: string,
  featureId: string,
  date: Date
) {
  await FeatureRevisionModel.deleteMany({
    organization,
    featureId,
    dateCreated: {
      $lt: date,
    },
  });
}
