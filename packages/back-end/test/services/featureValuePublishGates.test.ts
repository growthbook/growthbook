import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/request";
import {
  collectFeaturePublishGates,
  FeatureMergePlan,
} from "back-end/src/services/featurePublishGates";
import { evaluatePublishGates } from "back-end/src/revisions/publishGates";

const plan: FeatureMergePlan = {
  environmentIds: ["production"],
  mergeResult: {},
  filledLiveRules: [],
  hasChanges: true,
  hasLinkedPendingRamp: false,
  requiresReview: false,
  uncoveredApprovers: [],
  hasCoveringApproval: false,
  requiredApproverTeams: { satisfied: true, unmet: [] },
  requiredProjectApprovers: { satisfied: true, unmet: [] },
  rebaseRequired: false,
  rebaseBlockReason: null,
};

const revision = { version: 2, status: "draft" } as FeatureRevisionInterface;
const context = { org: { settings: {} } } as unknown as ReqContext;

describe("feature value publish gates", () => {
  it.each(["json", "boolean", "number"] as const)(
    "returns a blocking gate for invalid %s instead of throwing",
    async (valueType) => {
      const feature = {
        id: "bad-feature",
        valueType,
        defaultValue: "null",
        rules: [],
      } as unknown as FeatureInterface;
      const gates = await collectFeaturePublishGates({
        context,
        feature,
        revision,
        plan: { ...plan, mergeResult: { defaultValue: "{ not-an-object }" } },
        includeValidationGates: true,
      });
      expect(gates).toEqual([
        expect.objectContaining({
          type: "invalid-feature-value",
          severity: "blocker",
          override: null,
        }),
      ]);
      expect(gates[0].messages[0]).toContain("Default value");
      const result = evaluatePublishGates(gates, {
        ignoreWarnings: true,
        skipSchemaValidation: true,
        skipHooks: true,
        bypassApprovalPermission: true,
        restApiBypassesReviews: true,
        canForceMergeStaleBase: true,
      });
      expect(result.blocking).toEqual(gates);
    },
  );

  it("collects rule errors alongside an approval gate", async () => {
    const feature = {
      id: "bad-feature",
      valueType: "json",
      defaultValue: "{}",
      rules: [],
    } as unknown as FeatureInterface;
    const gates = await collectFeaturePublishGates({
      context,
      feature,
      revision,
      plan: {
        ...plan,
        requiresReview: true,
        mergeResult: {
          rules: [
            {
              id: "bad-rule",
              type: "force",
              value: "{ not-an-object }",
              description: "",
              allEnvironments: true,
            },
          ],
        },
      },
      includeValidationGates: true,
    });
    expect(gates.map((gate) => gate.type)).toEqual([
      "approval-required",
      "invalid-feature-value",
    ]);
    expect(gates[1].messages[0]).toContain("Rule #1");
  });
});
