import mongoose from "mongoose";
import omit from "lodash/omit";
import { checkIfRevisionNeedsReview } from "shared/util";
import { FeatureInterface, FeatureRule } from "../../types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "../../types/feature-revision";
import { EventUser, EventUserLoggedIn } from "../events/event-types";
import { OrganizationInterface, ReqContext } from "../../types/organization";

export type ReviewSubmittedType = "Comment" | "Approved" | "Requested Changes";

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
  requiresReview: Boolean,
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
featureRevisionSchema.index({ organization: 1, status: 1 });

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema
);

function toInterface(doc: FeatureRevisionDocument): FeatureRevisionInterface {
  const revision = omit(doc.toJSON<FeatureRevisionDocument>(), ["__v", "_id"]);

  // These fields are new, so backfill them for old revisions
  if (revision.publishedBy && !revision.publishedBy.type) {
    (revision.publishedBy as EventUserLoggedIn).type = "dashboard";
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

export async function getRevisionsByStatus(
  context: ReqContext,
  statuses: string[]
) {
  const revisions = await FeatureRevisionModel.find({
    organization: context.org.id,
    status: { $in: statuses },
  });
  const docs = revisions
    .filter((r) => !!r)
    .map((r) => {
      return toInterface(r);
    });

  return docs;
}

export async function createInitialRevision(
  feature: FeatureInterface,
  user: EventUser | null,
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
  org,
  canBypassApprovalChecks,
}: {
  feature: FeatureInterface;
  user: EventUser;
  environments: string[];
  baseVersion?: number;
  changes?: Partial<FeatureRevisionInterface>;
  publish?: boolean;
  comment?: string;
  org: OrganizationInterface;
  canBypassApprovalChecks?: boolean;
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
  if (!baseVersion) baseVersion = lastRevision?.version;
  const baseRevision =
    lastRevision?.version === baseVersion
      ? lastRevision
      : await getRevision(feature.organization, feature.id, baseVersion);

  if (!baseRevision) {
    throw new Error("can not find a base revision");
  }
  const status = "draft";
  const revision = {
    organization: feature.organization,
    featureId: feature.id,
    version: newVersion,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: null,
    createdBy: user,
    baseVersion: baseVersion || feature.version,
    status,
    publishedBy: null,
    comment: comment || "",
    defaultValue,
    rules,
    log: [log],
  } as FeatureRevisionInterface;
  const requiresReview = checkIfRevisionNeedsReview({
    feature,
    baseRevision,
    revision,
    allEnvironments: environments,
    settings: org.settings,
  });
  if (publish && (!requiresReview || canBypassApprovalChecks)) {
    revision.status = "published";
    revision.publishedBy = user;
    revision.datePublished = new Date();
  } else if (publish && requiresReview) {
    revision.status = "pending-review";
  }

  const doc = await FeatureRevisionModel.create(revision);

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
  log: Omit<RevisionLog, "timestamp">,
  resetReview: boolean
) {
  let status = revision.status;

  // If editing defaultValue or rules, require the revision to be a draft
  if ("defaultValue" in changes || changes.rules) {
    if (
      !(
        revision.status === "draft" ||
        revision.status === "pending-review" ||
        revision.status === "approved" ||
        revision.status === "changes-requested"
      )
    ) {
      throw new Error("Can only update draft revisions");
    }
    // reset the changes requested since there is no way to reset at the moment.
    if (revision.status === "changes-requested") {
      status = "pending-review";
    }
  }
  if (resetReview && revision.status === "approved") {
    status = "pending-review";
  }
  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { ...changes, status, dateUpdated: new Date() },
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
  user: EventUser,
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
  const revisionComment = revision.comment ? revision.comment : comment;
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
        comment: revisionComment,
      },
      $push: {
        log,
      },
    }
  );
}

export async function markRevisionAsReviewRequested(
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string
) {
  const action = "Review Requested";

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
        datePublished: null,
        dateUpdated: new Date(),
        comment: comment,
      },
      $push: {
        log,
      },
    }
  );
}

export async function submitReviewAndComments(
  revision: FeatureRevisionInterface,
  user: EventUser,
  reviewSubmittedType: ReviewSubmittedType,
  comment?: string
) {
  const action = reviewSubmittedType;
  let status = "pending-review";
  switch (reviewSubmittedType) {
    case "Approved":
      status = "approved";
      break;
    case "Requested Changes":
      status = "changes-requested";
      break;
    default:
      // we dont want comments to override approved state
      status = revision.status;
  }
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
        status,
        datePublished: null,
        dateUpdated: new Date(),
      },
      $push: {
        log,
      },
    }
  );
}

export async function discardRevision(
  revision: FeatureRevisionInterface,
  user: EventUser
) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Can not discard ${revision.status} revisions`);
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
export async function getFeatureRevisionsByFeaturesCurrentVersion(
  features: FeatureInterface[]
): Promise<FeatureRevisionInterface[] | null> {
  if (features.length === 0) return null;
  const docs = await FeatureRevisionModel.find({
    $or: features.map((f) => ({
      featureId: f.id,
      organization: f.organization,
      version: f.version,
    })),
  });

  return docs.map(toInterface);
}

export async function getFeatureRevisionsByFeaturesDraftVersion(
  features: FeatureInterface[]
): Promise<FeatureRevisionInterface[] | null> {
  if (features.length === 0) return null;
  const docs = await FeatureRevisionModel.find({
    $or: features.map((f) => ({
      featureId: f.id,
      organization: f.organization,
      state: "draft",
    })),
  });

  return docs.map(toInterface);
}
