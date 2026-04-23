import { removeSDKConnectionFromSdkWebhooks } from "back-end/src/models/WebhookModel";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util", () => {
  const actual = jest.requireActual("back-end/src/util/mongo.util");
  return {
    ...actual,
    getCollection: jest.fn(),
  };
});

describe("removeSDKConnectionFromSdkWebhooks", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("removes the sdk id from sdk-mode webhooks and deletes orphaned webhooks", async () => {
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 });

    (getCollection as jest.Mock).mockReturnValue({ updateMany, deleteMany });

    await removeSDKConnectionFromSdkWebhooks("org_123", "sdk_abc");

    expect(getCollection).toHaveBeenCalledWith("webhooks");
    expect(updateMany).toHaveBeenCalledWith(
      {
        organization: "org_123",
        useSdkMode: true,
        sdks: "sdk_abc",
      },
      {
        $pull: {
          sdks: "sdk_abc",
        },
      },
    );
    expect(deleteMany).toHaveBeenCalledWith({
      organization: "org_123",
      useSdkMode: true,
      sdks: { $size: 0 },
    });
  });
});
