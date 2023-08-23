import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import omit from "lodash/omit";
import {
  FeatureReview,
  FeatureReviewApproval,
  FeatureReviewDismissal,
  FeatureReviewPending,
  FeatureReviewRejection,
  FeatureReviewRequest,
} from "../../types/feature-review";

const featureReviewSchema = new mongoose.Schema(
  {
    state: {
      type: String,
      required: true,
      enum: ["approved", "rejected", "pending", "dismissed"],
    },
    approvedAt: {
      type: Date,
      required: false,
    },
    rejectedAt: {
      type: Date,
      required: false,
    },
    requestedAt: {
      type: Date,
      required: false,
    },
    dismissedAt: {
      type: Date,
      required: false,
    },
    comments: {
      type: String,
      required: false,
    },
  },
  {
    _id: false,
  }
);

const featureReviewRequestSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  dateCreated: {
    type: Date,
    required: true,
  },
  organizationId: {
    type: String,
    required: true,
  },
  userId: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  state: {
    type: String,
    required: true,
    enum: ["active", "stale"],
  },
  featureId: {
    type: String,
    required: true,
  },
  featureRevisionId: {
    type: String,
    required: true,
  },
  reviews: {
    type: Map,
    of: featureReviewSchema,
  },
});

featureReviewRequestSchema.index({ organizationId: 1, dateCreated: -1 });

type FeatureReviewRequestDocument = mongoose.Document & FeatureReviewRequest;

/**
 * Convert the Mongo document to an interface, omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = (doc: FeatureReviewRequestDocument): FeatureReviewRequest =>
  omit(
    doc.toJSON<FeatureReviewRequestDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  ) as FeatureReviewRequest;

const FeatureReviewRequestModel = mongoose.model<FeatureReviewRequest>(
  "FeatureReviewRequest",
  featureReviewRequestSchema
);

// region Review types

const createPendingReview = (): FeatureReviewPending => ({
  state: "pending",
  requestedAt: new Date(),
});

const createApprovedReview = (): FeatureReviewApproval => ({
  state: "approved",
  approvedAt: new Date(),
});

const createDismissedReview = ({
  approvedAt,
  comments = "",
}: {
  approvedAt: Date;
  comments?: string;
}): FeatureReviewDismissal => ({
  state: "dismissed",
  approvedAt,
  dismissedAt: new Date(),
  comments,
});

const createRejectedReview = ({
  comments,
}: {
  comments: string;
}): FeatureReviewRejection => ({
  state: "rejected",
  rejectedAt: new Date(),
  comments,
});

// endregion Review types

// region create FeatureReviewRequest

type CreateFeatureReviewRequestParams = {
  organizationId: string;
  userId: string;
  featureId: string;
  featureRevisionId: string;
  description: string;
  requestedUserIds: string[];
};

export const createFeatureReviewRequest = async ({
  organizationId,
  featureId,
  featureRevisionId,
  description,
  requestedUserIds,
  userId,
}: CreateFeatureReviewRequestParams): Promise<FeatureReviewRequest> => {
  const reviews = requestedUserIds.reduce<Record<string, FeatureReview>>(
    (prev, curr) => {
      prev[curr] = createPendingReview();
      return prev;
    },
    {}
  );

  const doc = await FeatureReviewRequestModel.create({
    id: `frr-${randomUUID()}`,
    dateCreated: new Date(),
    userId,
    organizationId,
    featureId,
    featureRevisionId,
    reviews,
    description,
    state: "active",
  });

  // todo: requestedUserIds.forEach { onReviewRequested() }

  return toInterface(doc);
};

// endregion create FeatureReviewRequest

// region update FeatureReviewRequest

type MarkFeatureReviewRequestStaleParams = {
  featureReviewRequestId: string;
  organizationId: string;
};

export const markFeatureReviewRequestAsStale = async ({
  organizationId,
  featureReviewRequestId,
}: MarkFeatureReviewRequestStaleParams): Promise<boolean> => {
  const result = await FeatureReviewRequestModel.updateOne(
    {
      id: featureReviewRequestId,
      organizationId,
    },
    {
      $set: {
        state: "stale",
      },
    }
  );

  return result.modifiedCount === 1;
};

type RequestReviewFromUserParams = {
  userId: string;
  featureReviewRequestId: string;
  organizationId: string;
};

/**
 * Finds an existing review request for the organization and adds the user to the list of users to review
 * @throws Error if the review request does not exist, or the a review was already requested for that user
 * @param organizationId
 * @param userId
 * @param featureReviewRequestId
 */
export const requestReviewFromUser = async ({
  organizationId,
  userId,
  featureReviewRequestId,
}: RequestReviewFromUserParams): Promise<void> => {
  const reviewRequest = await FeatureReviewRequestModel.findOne({
    id: featureReviewRequestId,
    organizationId,
  });

  if (!reviewRequest) {
    throw new Error(
      `No feature review request with ID ${featureReviewRequestId} for organization ${organizationId}`
    );
  }

  const existingReview = reviewRequest.get(`reviews.${userId}`);
  if (existingReview) {
    throw new Error(`Review request for ${userId} already exists`);
  }

  reviewRequest.set(`reviews.${userId}`, createPendingReview());
  await reviewRequest.save();

  await onReviewRequested({ userId, featureReviewRequestId });
};

type OnReviewRequestedParams = {
  userId: string;
  featureReviewRequestId: string;
};

const onReviewRequested = async ({
  userId,
  featureReviewRequestId,
}: OnReviewRequestedParams): Promise<void> => {
  // todo: email notification
};

type ApproveReviewParams = {
  userId: string; // user ID of the reviewer
  featureReviewRequestId: string;
  organizationId: string;
};

/**
 * Approve a feature review request as a user.
 * @throws Error if the review request doesn't exist, or the user approving doesn't exist in the list of reviewers
 * @param userId
 * @param featureReviewRequestId
 * @param organizationId
 */
export const approveReviewAsUser = async ({
  userId,
  featureReviewRequestId,
  organizationId,
}: ApproveReviewParams): Promise<void> => {
  const reviewRequest = await FeatureReviewRequestModel.findOne({
    id: featureReviewRequestId,
    organizationId,
  });

  if (!reviewRequest) {
    throw new Error(
      `No feature review request with ID ${featureReviewRequestId} for organization ${organizationId}`
    );
  }

  const existingReview = reviewRequest.get(`reviews.${userId}`);
  if (!existingReview) {
    throw new Error(`Review for user ${userId} was not requested`);
  }

  reviewRequest.set(`reviews.${userId}`, createApprovedReview());
  await reviewRequest.save();

  await onReviewAnswer({ userId, featureReviewRequestId, answer: "approved" });
};

type OnReviewAnswerParams = {
  userId: string;
  featureReviewRequestId: string;
  answer: "approved" | "rejected";
};

const onReviewAnswer = async (_params: OnReviewAnswerParams): Promise<void> => {
  // const onReviewAnswer = async ({
  //   userId,
  //   featureReviewRequestId,
  //   answer,
  // }: OnReviewAnswerParams): Promise<void> => {
  // todo: email notification
  // your request has been approved
  // your request has been rejected
};

type RejectReviewParams = {
  userId: string; // user ID of the reviewer
  featureReviewRequestId: string;
  organizationId: string;
  comments: string;
};

/**
 * Reject a feature review request as a user.
 * @throws Error if the review request doesn't exist
 * @param userId
 * @param featureReviewRequestId
 * @param organizationId
 * @param comments
 */
export const rejectReviewAsUser = async ({
  userId,
  featureReviewRequestId,
  organizationId,
  comments,
}: RejectReviewParams): Promise<void> => {
  const reviewRequest = await FeatureReviewRequestModel.findOne({
    id: featureReviewRequestId,
    organizationId,
  });

  if (!reviewRequest) {
    throw new Error(
      `No feature review request with ID ${featureReviewRequestId} for organization ${organizationId}`
    );
  }

  reviewRequest.set(`reviews.${userId}`, createRejectedReview({ comments }));
  await reviewRequest.save();

  await onReviewAnswer({ userId, featureReviewRequestId, answer: "rejected" });
};

type DismissReviewParams = {
  userId: string; // user ID of the reviewer
  featureReviewRequestId: string;
  organizationId: string;
  comments: string;
};

/**
 * @throws Error if the review request doesn't exist or there's no existing review from the user
 * @param userId
 * @param featureReviewRequestId
 * @param organizationId
 * @param comments
 */
export const dismissReviewAsUser = async ({
  userId,
  featureReviewRequestId,
  organizationId,
  comments,
}: DismissReviewParams): Promise<void> => {
  const reviewRequest = await FeatureReviewRequestModel.findOne({
    id: featureReviewRequestId,
    organizationId,
  });

  if (!reviewRequest) {
    throw new Error(
      `No feature review request with ID ${featureReviewRequestId} for organization ${organizationId}`
    );
  }

  const existingReview = reviewRequest.get(`reviews.${userId}`);
  if (!existingReview) {
    throw new Error(`No review by user ${userId} to dismiss`);
  }

  reviewRequest.set(
    `reviews.${userId}`,
    createDismissedReview({
      approvedAt: existingReview.approvedAt,
      comments,
    })
  );
  await reviewRequest.save();
};

// endregion update FeatureReviewRequest
