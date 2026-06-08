import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  mergeSdkPayloadRefreshRequests,
  payloadKeyId,
} from "back-end/src/services/sdkPayloadRefreshCoalescer";

describe("sdkPayloadRefreshCoalescer", () => {
  it("merges payload keys and sdk connections without duplicates", () => {
    const conn1 = { key: "sdk-1" } as SDKConnectionInterface;
    const conn2 = { key: "sdk-2" } as SDKConnectionInterface;

    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        sdkConnections: [conn1],
        auditContext: { event: "updated", model: "feature", id: "a" },
        stackTrace: "first",
      },
      {
        payloadKeys: [
          { environment: "production", project: "p1" },
          { environment: "staging", project: "" },
        ],
        sdkConnections: [conn1, conn2],
        treatEmptyProjectAsGlobal: true,
        auditContext: { event: "updated", model: "feature", id: "b" },
        stackTrace: "second",
      },
    ]);

    expect(merged.payloadKeys).toEqual([
      { environment: "production", project: "p1" },
      { environment: "staging", project: "" },
    ]);
    expect(merged.sdkConnections).toEqual([conn1, conn2]);
    expect(merged.treatEmptyProjectAsGlobal).toBe(true);
    expect(merged.auditContext).toEqual({
      event: "updated",
      model: "feature",
      id: "b",
    });
    expect(merged.stackTrace).toBe("second");
  });

  it("drops conflicting skipRefreshForProject values", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "deleted",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "other",
      },
    ]);

    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("does not restore skipRefreshForProject after a conflict", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "A",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "B",
      },
      {
        payloadKeys: [{ environment: "production", project: "p3" }],
        skipRefreshForProject: "A",
      },
    ]);

    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("clears skipRefreshForProject when a later request omits it", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
        skipRefreshForProject: "A",
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
      },
    ]);
    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("clears skipRefreshForProject when an earlier request omits it", () => {
    const merged = mergeSdkPayloadRefreshRequests([
      {
        payloadKeys: [{ environment: "production", project: "p1" }],
      },
      {
        payloadKeys: [{ environment: "production", project: "p2" }],
        skipRefreshForProject: "A",
      },
    ]);
    expect(merged.skipRefreshForProject).toBeUndefined();
  });

  it("payloadKeyId is stable for deduplication", () => {
    const key = { environment: "production", project: "p1" };
    expect(payloadKeyId(key)).toBe(payloadKeyId({ ...key }));
    expect(payloadKeyId({ environment: "production", project: "p1" })).toBe(
      payloadKeyId({ project: "p1", environment: "production" }),
    );
  });
});
