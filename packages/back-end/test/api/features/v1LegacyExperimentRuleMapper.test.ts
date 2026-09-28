import type { FeatureInterface } from "shared/types/feature";
import type { ReqContext } from "back-end/types/organization";
import { fromApiEnvSettingsRulesToFeatureEnvSettingsRules } from "back-end/src/services/features";

// The v1 write schema accepts targeting on a legacy inline experiment rule
// (a GET emits it); the mapper must carry it rather than accept-and-drop.
describe("v1 mapper: legacy inline experiment rule targeting", () => {
  const context = {
    canSkipSchemaValidationFor: () => false,
    org: { settings: {} },
  } as unknown as ReqContext;
  const feature = {
    id: "f",
    valueType: "boolean",
    project: "",
  } as unknown as FeatureInterface;

  it("carries condition and saved groups through to the stored rule", () => {
    const [rule] = fromApiEnvSettingsRulesToFeatureEnvSettingsRules(
      context,
      feature,
      [
        {
          type: "experiment",
          condition: '{"country": "US"}',
          savedGroupTargeting: [{ matchType: "all", savedGroups: ["grp_1"] }],
          values: [
            { value: "true", weight: 0.5 },
            { value: "false", weight: 0.5 },
          ],
        },
      ] as Parameters<
        typeof fromApiEnvSettingsRulesToFeatureEnvSettingsRules
      >[2],
    );
    expect(rule).toMatchObject({
      type: "experiment",
      condition: '{"country": "US"}',
      savedGroups: [{ match: "all", ids: ["grp_1"] }],
    });
  });
});
