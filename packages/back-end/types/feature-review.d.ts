export type FeatureReview = {
  state: "approved" | "rejected" | "pending" | "dismissed";
  requestedAt?: Date | string;
  approvedAt?: Date | string;
  rejectedAt?: Date | string;
  dismissedAt?: Date | string;
  comments?: string;
};

export type FeatureReviewApproval = {
  state: "approved";
  approvedAt: Date;
};
export type FeatureReviewRejection = {
  state: "rejected";
  rejectedAt: Date;
  comments: string;
};
export type FeatureReviewDismissal = {
  state: "dismissed";
  approvedAt: Date; // the original approval timestamp
  dismissedAt: Date; // the dismissed at timestamp
  comments: string;
};
export type FeatureReviewPending = {
  state: "pending";
  requestedAt: Date | string;
};

export type FeatureReviewRequest = {
  id: string;
  description: string;
  dateCreated: Date | string;
  organizationId: string;
  userId: string;
  state: "active" | "stale";
  featureId: string;
  featureRevisionId: string;
  reviews: Record<string, FeatureReview>;
};
