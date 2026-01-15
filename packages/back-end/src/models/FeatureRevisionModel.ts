import mongoose from "mongoose";
import omit from "lodash/omit";
import { checkIfRevisionNeedsReview } from "shared/util";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  FeatureRevisionInterface,
  RevisionLog,
} from "shared/types/feature-revision";
import { EventUser, EventUserLoggedIn } from "shared/types/events/event-types";
import { OrganizationInterface } from "shared/types/organization";
import { MinimalFeatureRevisionInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { applyEnvironmentInheritance } from "back-end/src/util/features";
import { logger } from "back-end/src/util/logger";
import { runValidateFeatureRevisionHooks } from "back-end/src/enterprise/sandbox/sandbox-eval";

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
      timestamp: Date,
      action: String,
      subject: String,
      value: String,
    },
  ],
});

featureRevisionSchema.index(
  { organization: 1, featureId: 1, version: 1 },
  { unique: true },
);
featureRevisionSchema.index({ organization: 1, status: 1 });

type FeatureRevisionDocument = mongoose.Document & FeatureRevisionInterface;

const FeatureRevisionModel = mongoose.model<FeatureRevisionInterface>(
  "FeatureRevision",
  featureRevisionSchema,
);

function toInterface(
  doc: FeatureRevisionDocument,
  context: ReqContext | ApiReqContext,
): FeatureRevisionInterface {
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

  revision.rules = applyEnvironmentInheritance(
    context.org.settings?.environments || [],
    revision.rules,
  );
  return revision;
}

export async function countDocuments(
  organization: string,
  featureId: string,
): Promise<number> {
  return FeatureRevisionModel.countDocuments({
    organization,
    featureId,
  });
}

export async function getMinimalRevisions(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
): Promise<MinimalFeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
  })
    .select("version datePublished dateUpdated createdBy status")
    .sort({ version: -1 })
    .limit(25);

  return docs.map((m) => ({
    version: m.version,
    datePublished: m.datePublished,
    dateUpdated: m.dateUpdated,
    createdBy: m.createdBy,
    status: m.status,
  }));
}

export async function getLatestRevisions(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureId: string,
): Promise<FeatureRevisionInterface[]> {
  const docs: FeatureRevisionDocument[] = await FeatureRevisionModel.find({
    organization,
    featureId,
  })
    .select("-log") // Remove the log when fetching all revisions since it can be large to send over the network
    .sort({ version: -1 })
    .limit(5);

  return docs.map((m) => toInterface(m, context));
}

export async function hasDraft(
  organization: string,
  feature: FeatureInterface,
  excludeVersions: number[] = [],
): Promise<boolean> {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId: feature.id,
    status: "draft",
    version: { $nin: excludeVersions },
  }).select("_id");

  return doc ? true : false;
}

export async function getFeatureRevisionsByStatus({
  context,
  organization,
  featureId,
  status,
  limit = 10,
  offset = 0,
  sort = "desc",
}: {
  context: ReqContext;
  organization: string;
  featureId: string;
  status?: string;
  limit?: number;
  offset?: number;
  sort?: "asc" | "desc";
}): Promise<FeatureRevisionInterface[]> {
  const docs = await FeatureRevisionModel.find({
    organization,
    featureId,
    ...(status ? { status } : {}),
  })
    .select("-log") // Remove the log when fetching all revisions since it can be large to send over the network
    .sort({ version: sort === "desc" ? -1 : 1 })
    .skip(offset)
    .limit(limit);
  return docs.map((m) => toInterface(m, context));
}

export async function getRevision({
  context,
  organization,
  featureId,
  version,
  includeLog = false,
}: {
  context: ReqContext | ApiReqContext;
  organization: string;
  featureId: string;
  version: number;
  includeLog?: boolean;
}) {
  const doc = await FeatureRevisionModel.findOne({
    organization,
    featureId,
    version,
  }).select(includeLog ? undefined : "-log");

  return doc ? toInterface(doc, context) : null;
}

export async function getRevisionsByStatus(
  context: ReqContext,
  statuses: string[],
) {
  const revisions = await FeatureRevisionModel.find({
    organization: context.org.id,
    status: { $in: statuses },
  }).select("-log"); // Remove the log when fetching all revisions since it can be large to send over the network

  const docs = revisions
    .filter((r) => !!r)
    .map((r) => {
      return toInterface(r, context);
    });

  return docs;
}

export async function createInitialRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  user: EventUser | null,
  environments: string[],
  date?: Date,
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

  return toInterface(doc, context);
}

export async function createRevisionFromLegacyDraft(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
) {
  if (!feature.legacyDraft) return;
  const doc = await FeatureRevisionModel.create(feature.legacyDraft);
  return toInterface(doc, context);
}

async function getLastRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
): Promise<FeatureRevisionInterface | null> {
  const lastRevision = (
    await FeatureRevisionModel.find({
      organization: context.org.id,
      featureId: feature.id,
    })
      .sort({ version: -1 })
      .limit(1)
  )[0];

  return lastRevision ? toInterface(lastRevision, context) : null;
}

export async function createRevision({
  context,
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
  context: ReqContext | ApiReqContext;
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
  const lastRevision = await getLastRevision(context, feature);
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

  if (!baseVersion) baseVersion = lastRevision?.version;
  if (!baseVersion) {
    throw new Error("can not determine base version for new revision");
  }

  const baseRevision =
    lastRevision?.version === baseVersion
      ? lastRevision
      : await getRevision({
          context,
          organization: feature.organization,
          featureId: feature.id,
          version: baseVersion,
        });

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

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision,
    original: baseRevision,
  });

  const doc = await FeatureRevisionModel.create(revision);

  // Fire and forget - no route that creates the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "new revision",
      subject: `based on revision #${baseVersion || feature.version}`,
      user,
      value: JSON.stringify({
        status: publish ? "published" : "draft",
        comment: comment || "",
        defaultValue,
        rules,
      }),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });

  return toInterface(doc, context);
}

export async function updateRevision(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  changes: Partial<
    Pick<
      FeatureRevisionInterface,
      "comment" | "defaultValue" | "rules" | "baseVersion"
    >
  >,
  log: Omit<RevisionLog, "timestamp">,
  resetReview: boolean,
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

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...changes,
      status,
    },
    original: revision,
  });

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { ...changes, status, dateUpdated: new Date() },
    },
  );

  // Fire and forget - no route that updates the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      ...log,
      featureId: revision.featureId,
      version: revision.version,
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function markRevisionAsPublished(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
) {
  const action = revision.status === "draft" ? "publish" : "re-publish";

  const revisionComment = revision.comment ? revision.comment : comment;

  const changes: Partial<FeatureRevisionInterface> = {
    status: "published",
    publishedBy: user,
    datePublished: new Date(),
    dateUpdated: new Date(),
    comment: revisionComment,
  };

  await runValidateFeatureRevisionHooks({
    context,
    feature,
    revision: {
      ...revision,
      ...changes,
    },
    original: revision,
  });

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: changes,
    },
  );

  // Fire and forget - no route that marks the revision as published expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function markRevisionAsReviewRequested(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
  comment?: string,
) {
  const action = "Review Requested";

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
    },
  );

  // Fire and forget - no route that marks the revision as Review Requested expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function submitReviewAndComments(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
  reviewSubmittedType: ReviewSubmittedType,
  comment?: string,
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
    },
  );

  // Fire and forget - no route that submits the review and comments expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action,
      subject: "",
      user,
      value: JSON.stringify(comment ? { comment } : {}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function discardRevision(
  context: ReqContext | ApiReqContext,
  revision: FeatureRevisionInterface,
  user: EventUser,
) {
  if (revision.status === "published" || revision.status === "discarded") {
    throw new Error(`Can not discard ${revision.status} revisions`);
  }

  await FeatureRevisionModel.updateOne(
    {
      organization: revision.organization,
      featureId: revision.featureId,
      version: revision.version,
    },
    {
      $set: { status: "discarded", dateUpdated: new Date() },
    },
  );

  // Fire and forget - no route that discards the revision expects the log to be there immediately
  context.models.featureRevisionLogs
    .create({
      featureId: revision.featureId,
      version: revision.version,
      action: "discard",
      subject: "",
      user,
      value: JSON.stringify({}),
    })
    .catch((e) => {
      logger.error(e, "Error creating revisionlog");
    });
}

export async function getFeatureRevisionsByFeatureIds(
  context: ReqContext | ApiReqContext,
  organization: string,
  featureIds: string[],
): Promise<Record<string, FeatureRevisionInterface[]>> {
  const revisionsByFeatureId: Record<string, FeatureRevisionInterface[]> = {};

  if (featureIds.length) {
    const revisions = await FeatureRevisionModel.find({
      organization,
      status: "draft",
      featureId: { $in: featureIds },
    })
      .select("-log") // Remove the log when fetching all revisions since it can be large to send over the network
      .sort({ version: -1 })
      .limit(10);
    revisions.forEach((revision) => {
      const featureId = revision.featureId;
      revisionsByFeatureId[featureId] = revisionsByFeatureId[featureId] || [];
      revisionsByFeatureId[featureId].push(toInterface(revision, context));
    });
  }

  return revisionsByFeatureId;
}

export async function deleteAllRevisionsForFeature(
  organization: string,
  featureId: string,
) {
  await FeatureRevisionModel.deleteMany({
    organization,
    featureId,
  });
}

export async function cleanUpPreviousRevisions(
  organization: string,
  featureId: string,
  date: Date,
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
  context: ReqContext | ApiReqContext,
  features: FeatureInterface[],
): Promise<FeatureRevisionInterface[] | null> {
  if (features.length === 0) return null;
  const docs = await FeatureRevisionModel.find({
    $or: features.map((f) => ({
      featureId: f.id,
      organization: f.organization,
      version: f.version,
    })),
  }).select("-log"); // Remove the log when fetching all revisions since it can be large to send over the network

  return docs.map((m) => toInterface(m, context));
}
