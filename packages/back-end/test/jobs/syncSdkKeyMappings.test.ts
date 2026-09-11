import {
  BATCH_SIZE,
  syncSdkKeyMappings,
} from "back-end/src/jobs/syncSdkKeyMappings";
import { syncCloudSDKMappings } from "back-end/src/services/licenseServerManagedClickhouse";

jest.mock("back-end/src/util/secrets", () => ({ IS_CLOUD: true }));
jest.mock("back-end/src/util/mongo.util", () => ({ getCollection: jest.fn() }));
jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  syncCloudSDKMappings: jest.fn(),
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

const mockSync = syncCloudSDKMappings as jest.Mock;

async function* docs(n: number, offset = 0) {
  for (let i = offset; i < offset + n; i++) {
    yield { key: `sdk-${i}`, organization: `org_${i % 3}` };
  }
}

beforeEach(() => jest.clearAllMocks());

describe("syncSdkKeyMappings", () => {
  it("posts in batches of BATCH_SIZE and flushes the remainder", async () => {
    mockSync.mockResolvedValue(undefined);
    await syncSdkKeyMappings(docs(BATCH_SIZE * 2 + 7));
    const sizes = mockSync.mock.calls.map(([batch]) => batch.length);
    expect(sizes).toEqual([BATCH_SIZE, BATCH_SIZE, 7]);
    expect(mockSync.mock.calls[0][0][0]).toEqual({
      key: "sdk-0",
      organization: "org_0",
    });
  });

  it("skips documents missing a key or organization", async () => {
    mockSync.mockResolvedValue(undefined);
    async function* mixed() {
      yield { key: "sdk-a", organization: "org_1" };
      yield { key: "", organization: "org_1" };
      yield { organization: "org_1" };
      yield { key: "sdk-b" };
      yield { key: "sdk-c", organization: "org_2" };
    }
    await syncSdkKeyMappings(mixed());
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync.mock.calls[0][0]).toEqual([
      { key: "sdk-a", organization: "org_1" },
      { key: "sdk-c", organization: "org_2" },
    ]);
  });

  it("keeps going when one batch fails", async () => {
    mockSync
      .mockRejectedValueOnce(new Error("license server down"))
      .mockResolvedValue(undefined);
    await syncSdkKeyMappings(docs(BATCH_SIZE + 1));
    expect(mockSync).toHaveBeenCalledTimes(2);
  });
});
