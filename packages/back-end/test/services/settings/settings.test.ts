import { getScopedSettings } from "../../../src/services/settings";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "../../../types/organization";
import { ProjectSettings } from "../../../types/project";
import { experiments, metrics } from "./test-objects";

const baseOrganization: OrganizationInterface = {
  dateCreated: new Date("2020-01-01"),
  id: "1",
  invites: [],
  members: [],
  name: "Test Org",
  ownerEmail: "",
  url: "test-org",
};

const mockProject: ProjectSettings = {
  statsEngine: "frequentist",
};

const genOrgWithSettings = (settings?: Partial<OrganizationSettings>) => ({
  ...baseOrganization,
  settings: settings ?? {},
});

describe("settings", () => {
  describe("getScopedSettings fn", () => {
    it("returns org settings if no scopes are applied", () => {
      const settings = { pValueThreshold: 0.001 };
      const organization = genOrgWithSettings(settings);

      const { settings: newSettings } = getScopedSettings(
        organization.settings
      );

      expect(newSettings.pValueThreshold.value).toEqual(
        settings.pValueThreshold
      );
    });

    it('applies project settings if "project" scope is applied', () => {
      const settings = { pValueThreshold: 0.001 };
      const organization = genOrgWithSettings(settings);

      const projectWithPValueOverride = {
        ...mockProject,
        pValueThreshold: 0.06,
      };

      const { settings: newSettings } = getScopedSettings(
        organization.settings,
        {
          project: projectWithPValueOverride,
        }
      );

      expect(newSettings.pValueThreshold.value).toEqual(
        projectWithPValueOverride.pValueThreshold
      );
    });

    describe("applying mixed metric overrides", () => {
      const organization = genOrgWithSettings({
        statsEngine: "frequentist",
      });

      describe("when the metric has no setting, and the experiment has no overrides", () => {
        it("defaults to the experiment setting", () => {
          // Signups
          const { settings: metricSettings_signups } = getScopedSettings(
            organization.settings,
            {
              metric: metrics.signups,
              experiment: experiments.exp1,
            }
          );

          expect(
            metricSettings_signups.regressionAdjustmentEnabled.value
          ).toEqual(true);
          expect(metricSettings_signups.statsEngine.value).toEqual(
            "frequentist"
          );
        });

        it("applies experiment-level metric overrides over metric settings where applicable (regressionAdjustmentDays)", () => {
          // Revenue
          const orgSettings: Partial<OrganizationSettings> = {
            statsEngine: "frequentist",
          };
          const org = genOrgWithSettings(orgSettings);
          const { settings: metricSettings_revenue } = getScopedSettings(
            org.settings,
            {
              metric: metrics.revenue2,
              experiment: experiments.exp1,
            }
          );

          expect(metricSettings_revenue.conversionDelayHours.value).toEqual(
            2.5
          );
          expect(metricSettings_revenue.conversionWindowHours.value).toEqual(
            72
          );
          expect(
            metricSettings_revenue.regressionAdjustmentEnabled.value
          ).toEqual(false);
          expect(
            metricSettings_revenue.regressionAdjustmentEnabled.meta.reason
          ).toEqual("disabled by metric override");

          expect(metricSettings_revenue.regressionAdjustmentDays.value).toEqual(
            0
          );
          expect(metricSettings_revenue.winRisk.value).toEqual(0.0025);
          expect(metricSettings_revenue.loseRisk.value).toEqual(0.0125);

          // Testvar
          const { settings: metricSettings_testvar } = getScopedSettings(
            organization.settings,
            {
              metric: metrics.testvar,
              experiment: experiments.exp1,
            }
          );

          expect(metricSettings_testvar.conversionDelayHours.value).toEqual(0);
          expect(metricSettings_testvar.conversionWindowHours.value).toEqual(
            72
          );
          expect(
            metricSettings_testvar.regressionAdjustmentEnabled.value
          ).toEqual(false);
          expect(
            metricSettings_testvar.regressionAdjustmentEnabled.meta.reason
          ).toEqual("custom aggregation");
          expect(metricSettings_testvar.regressionAdjustmentDays.value).toEqual(
            0
          );
          expect(metricSettings_testvar.winRisk.value).toEqual(0.0015);
          expect(metricSettings_testvar.loseRisk.value).toEqual(0.0225);

          // CUPED denominator is count rejection
          // const conversions_as_count: MetricInterface = {
          //   ...metrics.conversions,
          //   type: "count",
          // };
          const { settings: metricSettings_testvar_2 } = getScopedSettings(
            org.settings,
            {
              metric: metrics.testvar2,
              denominatorMetric: {
                ...metrics.conversions,
                type: "count",
              },
              experiment: experiments.exp1,
            }
          );
          expect(
            metricSettings_testvar_2.regressionAdjustmentEnabled.value
          ).toEqual(false);
          expect(
            metricSettings_testvar_2.regressionAdjustmentEnabled.meta.reason
          ).toEqual("denominator is count");
        });
      });
    });

    it("overrides stats-related metrics based on stats engine", () => {
      const orgSettings1: Partial<OrganizationSettings> = {
        statsEngine: "bayesian",
        confidenceLevel: 0.95,
        pValueThreshold: 0.05,
      };
      const org1 = genOrgWithSettings(orgSettings1);
      const { settings: settings_revenue_1 } = getScopedSettings(
        org1.settings,
        {
          metric: metrics.revenue,
          experiment: experiments.exp1,
        }
      );

      // org level:
      expect(settings_revenue_1.regressionAdjustmentEnabled.value).toEqual(
        false
      );
      expect(
        settings_revenue_1.regressionAdjustmentEnabled.meta.reason
      ).toEqual("stats engine is bayesian");
      // TODO
      // expect(settings_revenue_1.pValueThreshold.meta.warning).toEqual(
      //   "stats engine is bayesian"
      // );
      expect(settings_revenue_1.confidenceLevel.value).toEqual(0.95);
      // metric level:
      expect(settings_revenue_1.winRisk.value).toEqual(0.0025);
      expect(settings_revenue_1.loseRisk.value).toEqual(0.0125);

      const orgSettings2: Partial<OrganizationSettings> = {
        statsEngine: "frequentist",
      };
      const org2 = genOrgWithSettings(orgSettings2);
      const { settings: settings_revenue_2 } = getScopedSettings(
        org2.settings,
        {
          metric: metrics.revenue,
          experiment: experiments.exp1,
        }
      );

      // org level:
      expect(settings_revenue_2.regressionAdjustmentEnabled.value).toEqual(
        true
      );
      expect(settings_revenue_2.pValueThreshold.value).toEqual(0.05);
      // TODO
      // expect(settings_revenue_2.confidenceLevel.meta.warning).toEqual(
      //   "stats engine is frequentist"
      // );
      // metric level:
      // TODO
      // expect(settings_revenue_1.winRisk.meta.warning).toEqual(
      //   "stats engine is bayesian"
      // );
      // expect(settings_revenue_1.loseRisk.meta.warning).toEqual(
      //   "stats engine is bayesian"
      // );
    });
  });
});
