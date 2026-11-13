import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { Context } from "back-end/src/models/BaseModel";
import {
  assertDirectWriteAllowed,
  assertSdkWebhookFields,
  sdkWebhookEditUpdates,
} from "back-end/src/services/sdkConnectionApprovals";

const connection = {
  id: "sdk-1",
  projects: ["prj-1"],
  environment: "production",
} as SDKConnectionInterface;

const context = (gated: boolean, canBypass = false) =>
  ({
    hasPremiumFeature: () => true,
    org: {
      settings: { approvalFlows: { sdkConnections: [{ required: gated }] } },
    },
    permissions: {
      canBypassSDKConnectionApprovalChecks: () => canBypass,
      throwPermissionError: () => {
        throw new Error("no permission");
      },
    },
  }) as unknown as Context;

describe("assertDirectWriteAllowed", () => {
  it("allows an ungated connection with nothing bypassed", () => {
    expect(assertDirectWriteAllowed(context(false), [connection])).toEqual([]);
  });

  it("refuses a gated connection from the app, even for a bypasser", () => {
    expect(() =>
      assertDirectWriteAllowed(context(true, true), [connection]),
    ).toThrow("requires approval");
  });

  it("makes REST ask, whatever authority it holds", () => {
    expect(() =>
      assertDirectWriteAllowed(context(true, true), [connection], {
        restBypass: true,
      }),
    ).toThrow("bypassApproval");
  });

  it("refuses a REST caller who asks without the setting or the permission", () => {
    expect(() =>
      assertDirectWriteAllowed(context(true), [connection], {
        bypassApproval: true,
        restBypass: false,
      }),
    ).toThrow("no permission");
  });

  it("reports which authority let a REST write through", () => {
    const via = (restBypass: boolean, canBypass: boolean) =>
      assertDirectWriteAllowed(context(true, canBypass), [connection], {
        bypassApproval: true,
        restBypass,
      }).map((g) => g.via);
    expect(via(true, false)).toEqual(["restApiBypassesReviews"]);
    expect(via(false, true)).toEqual(["bypassApprovalPermission"]);
  });
});

describe("SDK webhook write rules", () => {
  it("accepts a URL endpoint and string headers, or no headers", () => {
    expect(() =>
      assertSdkWebhookFields({
        endpoint: "https://example.com/hook",
        headers: '{"X-Token":"{{[secret]}}"}',
      }),
    ).not.toThrow();
    expect(() => assertSdkWebhookFields({ headers: "" })).not.toThrow();
  });

  it("refuses a non-URL endpoint and headers that aren't an object of strings", () => {
    expect(() => assertSdkWebhookFields({ endpoint: "not a url" })).toThrow(
      "endpoint must be a URL",
    );
    expect(() => assertSdkWebhookFields({ headers: '{"X-Num":1}' })).toThrow(
      "headers must be",
    );
    expect(() => assertSdkWebhookFields({ headers: "{oops" })).toThrow(
      "headers must be",
    );
  });

  it("clears the failure record only when the endpoint changes", () => {
    const webhook = { endpoint: "https://old.example" };
    expect(
      sdkWebhookEditUpdates(webhook, { endpoint: "https://new.example" }),
    ).toEqual({
      endpoint: "https://new.example",
      consecutiveFailures: 0,
      disabled: false,
    });
    expect(
      sdkWebhookEditUpdates(webhook, {
        endpoint: "https://old.example",
        name: "Renamed",
      }),
    ).toEqual({ endpoint: "https://old.example", name: "Renamed" });
  });
});
