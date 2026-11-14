import { describe, expect, it } from "vitest";
import { applyApprovalFlowEntitlements } from "@/hooks/useOrgSettings";

describe("applyApprovalFlowEntitlements", () => {
  const approvalFlows = {
    savedGroups: [{ required: true, projects: [] }],
    sdkConnections: [
      { required: true, projects: ["prj_a"], environments: ["production"] },
    ],
  };

  it("passes every family through when licensed", () => {
    expect(applyApprovalFlowEntitlements(approvalFlows, true)).toBe(
      approvalFlows,
    );
  });

  it("switches off every family's rules when unlicensed, keeping their scope", () => {
    expect(applyApprovalFlowEntitlements(approvalFlows, false)).toEqual({
      savedGroups: [{ required: false, projects: [] }],
      sdkConnections: [
        { required: false, projects: ["prj_a"], environments: ["production"] },
      ],
    });
  });

  it("does not invent SDK connection rules", () => {
    const result = applyApprovalFlowEntitlements(
      { savedGroups: [{ required: true }] },
      false,
    );
    expect(result && "sdkConnections" in result).toBe(false);
  });
});
