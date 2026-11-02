import type { FeatureInterface } from "shared/validators";
import { submitFeatureRevisionReview } from "back-end/src/services/featureRevisionReview";
import {
  getRevision,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";

jest.mock("back-end/src/models/FeatureRevisionModel", () => ({
  getRevision: jest.fn(),
  submitReviewAndComments: jest.fn(),
}));
jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  dispatchRevisionReviewEvent: jest.fn(),
}));
jest.mock("back-end/src/api/features/autoPublishOnApproval", () => ({
  maybeAutoPublishFeatureRevision: jest.fn(),
}));

const mockGetRevision = getRevision as jest.Mock;
const mockSubmit = submitReviewAndComments as jest.Mock;

const feature = {
  id: "checkout-test",
  organization: "org_1",
  project: "",
  version: 4,
} as unknown as FeatureInterface;

// `actorId` is the person (also its `userId`), else the org key acting as
// itself; "" for neither.
const contextFor = (actorId: string) =>
  ({
    org: { id: "org_1", settings: {} },
    userId: actorId.startsWith("u_") ? actorId : "",
    actorId,
    auditUser: { type: "system" },
    hasPremiumFeature: () => false,
    permissions: {
      canReviewFeatureDrafts: () => true,
      canAddComment: () => true,
      canRevisionAction: () => true,
      throwPermissionError: () => {
        throw new Error("permission error");
      },
    },
  }) as never;

/** `createdBy` has no `id` when an API key opened the draft. */
const revisionCreatedBy = (createdBy: unknown) => ({
  version: 3,
  status: "pending-review",
  contributors: [],
  createdBy,
});

const approve = (actorId: string, createdBy: unknown) => {
  mockGetRevision.mockResolvedValue(revisionCreatedBy(createdBy));
  return submitFeatureRevisionReview({
    context: contextFor(actorId),
    feature,
    version: 3,
    review: "Approved",
    comment: "",
    eventAudit: { type: "api_key", apiKey: "key_1" },
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue({ applied: true });
});

describe("submitFeatureRevisionReview author separation", () => {
  it.each([
    // An identityless principal on an authorless draft.
    ["", null],
    ["key_1", { type: "api_key", apiKey: "key_1" }],
    ["u_1", { type: "dashboard", id: "u_1" }],
  ] as const)(
    "blocks %j approving a draft created by %j",
    async (actorId, createdBy) => {
      await expect(approve(actorId, createdBy)).rejects.toThrow(
        "Cannot submit a review on a draft you created",
      );
      expect(mockSubmit).not.toHaveBeenCalled();
    },
  );

  it.each([
    { type: "dashboard", id: "u_1" },
    { type: "api_key", apiKey: "key_1" },
  ])("allows a user to approve a draft created by %j", async (createdBy) => {
    await approve("u_2", createdBy);
    expect(mockSubmit).toHaveBeenCalled();
  });
});
