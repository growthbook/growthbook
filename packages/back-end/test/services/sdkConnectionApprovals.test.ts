import type { SDKConnectionInterface } from "shared/types/sdk-connection";
import type { Context } from "back-end/src/models/BaseModel";
import { assertSdkWebhooksEditableDirectly } from "back-end/src/services/sdkConnectionApprovals";

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
    permissions: { canBypassSDKConnectionApprovalChecks: () => canBypass },
  }) as unknown as Context;

describe("assertSdkWebhooksEditableDirectly", () => {
  it("allows an ungated connection", () => {
    expect(() =>
      assertSdkWebhooksEditableDirectly(context(false), [connection]),
    ).not.toThrow();
  });

  it("refuses a gated connection from the app, even for a bypasser", () => {
    expect(() =>
      assertSdkWebhooksEditableDirectly(context(true, true), [connection]),
    ).toThrow("requires approval");
  });

  it("lets REST through with the org setting or the bypass permission", () => {
    expect(() =>
      assertSdkWebhooksEditableDirectly(context(true), [connection], true),
    ).not.toThrow();
    expect(() =>
      assertSdkWebhooksEditableDirectly(
        context(true, true),
        [connection],
        false,
      ),
    ).not.toThrow();
    expect(() =>
      assertSdkWebhooksEditableDirectly(context(true), [connection], false),
    ).toThrow("requires approval");
  });
});
