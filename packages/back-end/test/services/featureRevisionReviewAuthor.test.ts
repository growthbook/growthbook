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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as FeatureInterface;

/** `userId` is "" for an API key, and a real id for a dashboard session. */
const contextFor = (userId: string) =>
  ({
    org: { id: "org_1", settings: {} },
    userId,
    auditUser: { type: "system" },
    permissions: {
      canReviewFeatureDrafts: () => true,
      canAddComment: () => true,
      canRevisionAction: () => true,
      throwPermissionError: () => {
        throw new Error("permission error");
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

/** `createdBy` has no `id` when an API key opened the draft. */
const revisionCreatedBy = (createdBy: unknown) => ({
  version: 3,
  status: "pending-review",
  contributors: [],
  createdBy,
});

const approve = (userId: string, createdBy: unknown) => {
  mockGetRevision.mockResolvedValue(revisionCreatedBy(createdBy));
  return submitFeatureRevisionReview({
    context: contextFor(userId),
    feature,
    version: 3,
    review: "Approved",
    comment: "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventAudit: { type: "api_key", apiKey: "key_1" } as any,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSubmit.mockResolvedValue({ applied: true });
});

describe("submitFeatureRevisionReview author separation", () => {
  it("blocks an identityless principal from approving an authorless draft", async () => {
    await expect(
      approve("", { type: "api_key", apiKey: "key_1" }),
    ).rejects.toThrow("Cannot submit a review on a draft you created");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("blocks a user from approving their own draft", async () => {
    await expect(
      approve("u_1", { type: "dashboard", id: "u_1" }),
    ).rejects.toThrow("Cannot submit a review on a draft you created");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("allows a user to approve someone else's draft", async () => {
    await approve("u_2", { type: "dashboard", id: "u_1" });
    expect(mockSubmit).toHaveBeenCalled();
  });

  it("allows a user to approve a draft an API key opened", async () => {
    await approve("u_2", { type: "api_key", apiKey: "key_1" });
    expect(mockSubmit).toHaveBeenCalled();
  });
});
