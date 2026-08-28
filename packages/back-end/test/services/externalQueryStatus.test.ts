import { ReqContext } from "back-end/types/request";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import { getIntegrationFromDatasourceId } from "back-end/src/services/datasource";
import { getExternalQueryStatusForDoc } from "back-end/src/services/externalQueryStatus";

jest.mock("back-end/src/services/datasource", () => ({
  getIntegrationFromDatasourceId: jest.fn(),
}));

const mockGetIntegration = getIntegrationFromDatasourceId as jest.Mock;

describe("getExternalQueryStatusForDoc", () => {
  const context = {} as ReqContext;
  const baseDoc = {
    id: "q1",
    datasource: "ds1",
    externalId: "job1",
    externalIdMetadata: undefined,
  };

  beforeEach(() => {
    mockGetIntegration.mockReset();
  });

  it("returns unsupported when the doc has no externalId", async () => {
    const status = await getExternalQueryStatusForDoc(
      context,
      { ...baseDoc, externalId: undefined },
      new Map(),
    );
    expect(status).toEqual({ state: "unknown", reason: "unsupported" });
    expect(mockGetIntegration).not.toHaveBeenCalled();
  });

  it("returns unreachable when the integration fails to load", async () => {
    mockGetIntegration.mockRejectedValue(new Error("decrypt failed"));
    expect(
      await getExternalQueryStatusForDoc(context, baseDoc, new Map()),
    ).toEqual({ state: "unknown", reason: "unreachable" });
  });

  it("caches a broken datasource so it is not retried per-doc", async () => {
    mockGetIntegration.mockRejectedValue(new Error("decrypt failed"));
    const cache = new Map<string, SourceIntegrationInterface | null>();
    await getExternalQueryStatusForDoc(context, baseDoc, cache);
    await getExternalQueryStatusForDoc(
      context,
      { ...baseDoc, id: "q2" },
      cache,
    );
    expect(mockGetIntegration).toHaveBeenCalledTimes(1);
  });

  it("returns unsupported when the integration cannot report status", async () => {
    mockGetIntegration.mockResolvedValue({} as SourceIntegrationInterface);
    expect(
      await getExternalQueryStatusForDoc(context, baseDoc, new Map()),
    ).toEqual({ state: "unknown", reason: "unsupported" });
  });

  it("returns unreachable when the status check throws", async () => {
    mockGetIntegration.mockResolvedValue({
      getExternalQueryStatus: jest.fn().mockRejectedValue(new Error("boom")),
    });
    expect(
      await getExternalQueryStatusForDoc(context, baseDoc, new Map()),
    ).toEqual({ state: "unknown", reason: "unreachable" });
  });

  it("passes the warehouse verdict through on success", async () => {
    mockGetIntegration.mockResolvedValue({
      getExternalQueryStatus: jest
        .fn()
        .mockResolvedValue({ state: "succeeded" }),
    });
    expect(
      await getExternalQueryStatusForDoc(context, baseDoc, new Map()),
    ).toEqual({ state: "succeeded" });
  });

  it("returns unreachable when the status check outlasts the timeout", async () => {
    jest.useFakeTimers();
    mockGetIntegration.mockResolvedValue({
      getExternalQueryStatus: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const pending = getExternalQueryStatusForDoc(context, baseDoc, new Map());
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await pending).toEqual({ state: "unknown", reason: "unreachable" });
    jest.useRealTimers();
  });
});
