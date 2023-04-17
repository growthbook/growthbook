import { useScopedSettings } from "../../../src/services/settings";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "../../../types/organization";
import { ProjectInterface } from "../../../types/project";
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

const mockProject: ProjectInterface = {
  id: "1",
  name: "Test Project",
  organization: "1",
  dateCreated: new Date("2020-01-01"),
  dateUpdated: new Date("2020-01-01"),
};

const genOrgWithSettings = (settings?: Partial<OrganizationSettings>) => ({
  ...baseOrganization,
  settings: settings ?? {},
});

describe("settings", () => {
  describe("useScopedSettings fn", () => {
    it("returns org settings if no scopes are applied", () => {
      const settings = { pValueThreshold: 0.001 };
      const organization = genOrgWithSettings(settings);

      const { settings: newSettings } = useScopedSettings(
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

      const { settings: newSettings } = useScopedSettings(
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
      const organization = genOrgWithSettings();

      describe("when the metric has no setting, and the experiment has no overrides", () => {
        it("defaults to the experiment setting", () => {
          // Signups
          const { settings: metricSettings_signups } = useScopedSettings(
            organization.settings,
            {
              metric: metrics.signups,
              experiment: experiments.exp1,
            }
          );

          expect(
            metricSettings_signups.regressionAdjustmentEnabled.value
          ).toEqual(true);
        });

        it("applies experiment-level metric overrides over metric settings where applicable (regressionAdjustmentDays)", () => {
          // Revenue
          const { settings: metricSettings_revenue } = useScopedSettings(
            organization.settings,
            {
              metric: metrics.revenue,
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
          ).toEqual("metric-level setting applied");
          expect(metricSettings_revenue.regressionAdjustmentDays.value).toEqual(
            8
          );
          expect(metricSettings_revenue.winRisk.value).toEqual(0.0025);
          expect(metricSettings_revenue.loseRisk.value).toEqual(0.0125);
        });

        // Testvar
        const { settings: metricSettings_testvar } = useScopedSettings(
          organization.settings,
          {
            metric: metrics.testvar,
            experiment: experiments.exp1,
          }
        );

        expect(metricSettings_testvar.conversionDelayHours.value).toEqual(0);
        expect(metricSettings_testvar.conversionWindowHours.value).toEqual(72);
        // TODO Q for Bryce - should this expect true instead?
        expect(
          metricSettings_testvar.regressionAdjustmentEnabled.value
        ).toEqual(false);
        expect(
          metricSettings_testvar.regressionAdjustmentEnabled.meta.reason ===
            "custom aggregation"
        );
        expect(
          metricSettings_testvar.regressionAdjustmentEnabled.meta.reason
        ).toEqual("experiment-level metric override applied");
        expect(metricSettings_testvar.regressionAdjustmentDays.value).toEqual(
          12
        );
        expect(metricSettings_testvar.winRisk.value).toEqual(0.0015);
        expect(metricSettings_testvar.loseRisk.value).toEqual(0.0225);

        // todo: add test for CUPED: denominator is count
      });
    });
  });
});
