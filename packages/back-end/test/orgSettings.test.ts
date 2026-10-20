import { CommercialFeature } from "shared/enterprise";
import { OrganizationSettings } from "shared/types/organization";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/constants";
import { ReqContext } from "back-end/types/request";
import {
  assertCanUpdateOrgSettings,
  validateOrgSettingsUpdate,
} from "back-end/src/services/orgSettings";

function makeContext(
  settings: OrganizationSettings,
  features: CommercialFeature[] = [],
) {
  return {
    org: { id: "org_1", settings },
    hasPremiumFeature: (f: CommercialFeature) => features.includes(f),
  } as unknown as ReqContext;
}

describe("validateOrgSettingsUpdate", () => {
  describe("plan gates", () => {
    it("refuses turning on a paid toggle without the feature", () => {
      expect(() =>
        validateOrgSettingsUpdate(makeContext({}), {
          useStickyBucketing: true,
        }),
      ).toThrow("Your plan does not support changing useStickyBucketing.");
    });

    it("allows turning it on with the feature", () => {
      expect(() =>
        validateOrgSettingsUpdate(makeContext({}, ["sticky-bucketing"]), {
          useStickyBucketing: true,
        }),
      ).not.toThrow();
    });

    it("lets an org that lost the feature re-save or turn it off", () => {
      const context = makeContext({ regressionAdjustmentEnabled: true });
      expect(() =>
        validateOrgSettingsUpdate(context, {
          regressionAdjustmentEnabled: true,
        }),
      ).not.toThrow();
      expect(() =>
        validateOrgSettingsUpdate(context, {
          regressionAdjustmentEnabled: false,
        }),
      ).not.toThrow();
    });

    it("treats an unset maxMetricSliceLevels as the default", () => {
      expect(() =>
        validateOrgSettingsUpdate(makeContext({}), {
          maxMetricSliceLevels: DEFAULT_MAX_METRIC_SLICE_LEVELS,
        }),
      ).not.toThrow();
      expect(() =>
        validateOrgSettingsUpdate(makeContext({}), {
          maxMetricSliceLevels: DEFAULT_MAX_METRIC_SLICE_LEVELS + 1,
        }),
      ).toThrow("maxMetricSliceLevels");
    });

    it("allows clearing custom markdown but not setting it", () => {
      const context = makeContext({ featureListMarkdown: "# hi" });
      expect(() =>
        validateOrgSettingsUpdate(context, { featureListMarkdown: "" }),
      ).not.toThrow();
      expect(() =>
        validateOrgSettingsUpdate(context, { featureListMarkdown: "# bye" }),
      ).toThrow("featureListMarkdown");
    });
  });

  describe("feature key settings", () => {
    it("refuses a regex that does not compile", () => {
      expect(() =>
        validateOrgSettingsUpdate(makeContext({}), {
          featureKeyExample: "abc",
          featureRegexValidator: "(",
        }),
      ).toThrow("not a valid regular expression");
    });

    it("checks the example against a regex set in an earlier save", () => {
      expect(() =>
        validateOrgSettingsUpdate(
          makeContext({
            featureKeyExample: "team-abc",
            featureRegexValidator: "^team-",
          }),
          { featureKeyExample: "abc" },
        ),
      ).toThrow("does not match the regex validator");
    });

    it("refuses resetting the example while a regex is set", () => {
      expect(() =>
        validateOrgSettingsUpdate(
          makeContext({
            featureKeyExample: "team-abc",
            featureRegexValidator: "^team-",
          }),
          { featureKeyExample: undefined },
        ),
      ).toThrow("must not be empty");
    });

    it("does not re-check values the save leaves unchanged", () => {
      expect(() =>
        validateOrgSettingsUpdate(
          makeContext({ featureKeyExample: "a b", featureRegexValidator: "" }),
          { featureKeyExample: "a b", statsEngine: "bayesian" },
        ),
      ).not.toThrow();
    });
  });

  it("bounds topValuesLookbackValue", () => {
    expect(() =>
      validateOrgSettingsUpdate(makeContext({}), {
        topValuesLookbackValue: 366,
      }),
    ).toThrow("between 1 and 365");
  });
});

describe("assertCanUpdateOrgSettings", () => {
  const allowed = {
    canManageOrgSettings: false,
    canManageTeam: false,
    canManageNorthStarMetric: false,
    canCreateSDKConnection: false,
  };
  function contextWith(grants: Partial<typeof allowed>) {
    const can = { ...allowed, ...grants };
    return {
      permissions: {
        canManageOrgSettings: () => can.canManageOrgSettings,
        canManageTeam: () => can.canManageTeam,
        canManageNorthStarMetric: () => can.canManageNorthStarMetric,
        canCreateSDKConnection: () => can.canCreateSDKConnection,
        throwPermissionError: () => {
          throw new Error("permission denied");
        },
      },
    } as unknown as ReqContext;
  }

  it("needs org settings permission for ordinary settings", () => {
    expect(() =>
      assertCanUpdateOrgSettings(contextWith({}), { statsEngine: "bayesian" }),
    ).toThrow("permission denied");
    expect(() =>
      assertCanUpdateOrgSettings(contextWith({ canManageOrgSettings: true }), {
        statsEngine: "bayesian",
      }),
    ).not.toThrow();
  });

  it("checks each special-cased setting against its own permission", () => {
    expect(() =>
      assertCanUpdateOrgSettings(contextWith({ canManageTeam: true }), {
        defaultRole: null,
      }),
    ).not.toThrow();
    expect(() =>
      assertCanUpdateOrgSettings(
        contextWith({ canManageNorthStarMetric: true }),
        { northStar: null },
      ),
    ).not.toThrow();
    expect(() =>
      assertCanUpdateOrgSettings(
        contextWith({ canCreateSDKConnection: true }),
        {
          visualEditorEnabled: true,
        },
      ),
    ).not.toThrow();
    expect(() =>
      assertCanUpdateOrgSettings(contextWith({ canManageOrgSettings: true }), {
        defaultRole: null,
      }),
    ).toThrow("permission denied");
  });

  it("refuses settings that have their own endpoints", () => {
    expect(() =>
      assertCanUpdateOrgSettings(contextWith({ canManageOrgSettings: true }), {
        environments: [],
      }),
    ).toThrow("with their own endpoints");
  });

  it("checks nothing for an empty update", () => {
    expect(() => assertCanUpdateOrgSettings(contextWith({}), {})).not.toThrow();
  });
});
