import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ReqContext } from "back-end/types/request";
import {
  collectFeaturePublishGates,
  FeatureMergePlan,
} from "back-end/src/services/featurePublishGates";
import { evaluatePublishGates } from "back-end/src/revisions/publishGates";

jest.mock("back-end/src/enterprise/sandbox/sandbox-eval", () => ({
  collectValidateFeatureHookResults: jest.fn().mockResolvedValue({
    hardErrors: [],
    warnings: [],
  }),
  collectValidateFeatureRevisionHookResults: jest.fn().mockResolvedValue({
    hardErrors: [],
    warnings: [],
  }),
}));

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
  const schema = (values: string[], enabled = true) => ({
    schemaType: "schema" as const,
    schema: JSON.stringify({ type: "string", enum: values }),
    simple: { type: "object" as const, fields: [] },
    date: new Date(),
    enabled,
  });

  describe.each(["default", "rule"])("%s value schema", (target) => {
    it.each([
      {
        name: "rejects values forbidden by a tighter staged schema",
        liveSchema: schema(["old", "new"]),
        stagedSchema: schema(["old"]),
        blocked: true,
      },
      {
        name: "allows values accepted by a looser staged schema",
        liveSchema: schema(["old"]),
        stagedSchema: schema(["old", "new"]),
        blocked: false,
      },
      {
        name: "allows values when the staged schema is disabled",
        liveSchema: schema(["old"]),
        stagedSchema: schema(["old"], false),
        blocked: false,
      },
      {
        name: "uses the live schema when no schema is staged",
        liveSchema: schema(["old"]),
        stagedSchema: null,
        blocked: true,
      },
    ])("$name", async ({ liveSchema, stagedSchema, blocked }) => {
      const feature = {
        id: "json-feature",
        valueType: "json",
        defaultValue: '"old"',
        rules: [],
        jsonSchema: liveSchema,
      } as unknown as FeatureInterface;
      const metadata = stagedSchema ? { jsonSchema: stagedSchema } : {};
      const gates = await collectFeaturePublishGates({
        context,
        feature,
        revision: { ...revision, metadata },
        plan: {
          ...plan,
          mergeResult: {
            metadata,
            ...(target === "default"
              ? { defaultValue: '"new"' }
              : {
                  rules: [
                    {
                      id: "new-rule",
                      type: "force" as const,
                      value: '"new"',
                      description: "",
                      allEnvironments: true,
                    },
                  ],
                }),
          },
        },
        includeValidationGates: true,
      });
      expect(gates.map((gate) => gate.type)).toEqual(
        blocked ? ["schema-validation"] : [],
      );
      expect(feature.jsonSchema).toBe(liveSchema);
    });
  });

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

  describe("staged JSON schema", () => {
    const objectSchema = (json: object) => ({
      schemaType: "schema" as const,
      schema: JSON.stringify(json),
      simple: { type: "object" as const, fields: [] },
      date: new Date(),
      enabled: true,
    });
    const loose = objectSchema({ type: "object" });
    const tight = objectSchema({ type: "object", required: ["color"] });
    const jsonFeature = (overrides: Partial<FeatureInterface>) =>
      ({
        id: "schema-feature",
        organization: "org",
        valueType: "json",
        defaultValue: "{}",
        rules: [],
        environmentSettings: {},
        ...overrides,
      }) as unknown as FeatureInterface;
    const schemaGate = async (
      feature: FeatureInterface,
      mergeResult: FeatureMergePlan["mergeResult"],
    ) => {
      const gates = await collectFeaturePublishGates({
        context,
        feature,
        revision,
        plan: { ...plan, mergeResult },
        includeValidationGates: true,
      });
      return gates.find((gate) => gate.type === "schema-validation");
    };

    it("checks unchanged live values against a tightened staged schema", async () => {
      const gate = await schemaGate(
        jsonFeature({
          jsonSchema: loose,
          rules: [
            {
              id: "fr_1",
              type: "force",
              value: '{"size":1}',
              description: "",
              allEnvironments: true,
            },
          ],
        }),
        { metadata: { jsonSchema: tight } },
      );
      expect(gate?.messages).toEqual([
        "Invalid feature value:",
        expect.stringContaining("Default value"),
        expect.stringContaining("Rule #1"),
      ]);
    });

    it("still skips unchanged values when the staged schema matches live", async () => {
      const gate = await schemaGate(jsonFeature({ jsonSchema: tight }), {
        metadata: { jsonSchema: { ...tight, date: new Date(0) } },
      });
      expect(gate).toBeUndefined();
    });
  });
});
