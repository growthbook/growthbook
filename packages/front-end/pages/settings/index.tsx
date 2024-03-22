import cronstrue from "cronstrue";
import React, { useEffect, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import isEqual from "lodash/isEqual";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { OrganizationSettings } from "@back-end/types/organization";
import { useAuth } from "@/services/auth";
import { hasFileConfig, isCloud } from "@/services/env";
import TempMessage from "@/components/TempMessage";
import Button from "@/components/Button";
import {
  OrganizationSettingsWithMetricDefaults,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import SelectField from "@/components/Forms/SelectField";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings from "@/components/GeneralSettings/ExperimentSettings";
import MetricsSettings from "@/components/GeneralSettings/MetricsSettings";
import FeaturesSettings from "@/components/GeneralSettings/FeaturesSettings";

export const DEFAULT_SRM_THRESHOLD = 0.001;

export const ConnectSettingsForm = ({ children }) => {
  const methods = useFormContext();
  return children({ ...methods });
};

function hasChanges(
  value: OrganizationSettings,
  existing: OrganizationSettings
) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const GeneralSettingsPage = (): React.ReactElement => {
  const {
    refreshOrganization,
    settings,
    organization,
    hasCommercialFeature,
  } = useUser();
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<OrganizationSettings>({});
  const [cronString, setCronString] = useState("");
  const [
    codeRefsBranchesToFilterStr,
    setCodeRefsBranchesToFilterStr,
  ] = useState<string>("");
  const displayCurrency = useCurrency();
  const { datasources } = useDefinitions();

  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");

  const { metricDefaults } = useOrganizationMetricDefaults();

  const form = useForm<OrganizationSettingsWithMetricDefaults>({
    defaultValues: {
      visualEditorEnabled: false,
      pastExperimentsMinLength: 6,
      metricAnalysisDays: 90,
      // customization:
      customized: false,
      logoPath: "",
      primaryColor: "#391c6d",
      secondaryColor: "#50279a",
      northStar: {
        //enabled: false,
        title: "",
        metricIds: [],
        //target: [],
        //window: "",
        //resolution?: string;
        //startDate?: Date;
      },
      metricDefaults: {
        minimumSampleSize: metricDefaults.minimumSampleSize,
        maxPercentageChange: metricDefaults.maxPercentageChange * 100,
        minPercentageChange: metricDefaults.minPercentageChange * 100,
      },
      updateSchedule: {
        type: "stale",
        hours: 6,
        cron: "0 */6 * * *",
      },
      runHealthTrafficQuery: false,
      srmThreshold: DEFAULT_SRM_THRESHOLD,
      multipleExposureMinPercent: 0.01,
      confidenceLevel: 0.95,
      pValueThreshold: DEFAULT_P_VALUE_THRESHOLD,
      pValueCorrection: null,
      statsEngine: DEFAULT_STATS_ENGINE,
      regressionAdjustmentEnabled: DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
      regressionAdjustmentDays: DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
      sequentialTestingEnabled: false,
      sequentialTestingTuningParameter: DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
      attributionModel: "firstExposure",
      displayCurrency,
      secureAttributeSalt: "",
      killswitchConfirmation: false,
      requireReviews: false,
      defaultDataSource: settings.defaultDataSource || "",
      useStickyBucketing: false,
      useFallbackAttributes: false,
      codeReferencesEnabled: false,
      codeRefsBranchesToFilter: [],
      codeRefsPlatformUrl: "",
    },
  });
  const { apiCall } = useAuth();

  const value = {
    visualEditorEnabled: form.watch("visualEditorEnabled"),
    pastExperimentsMinLength: form.watch("pastExperimentsMinLength"),
    metricAnalysisDays: form.watch("metricAnalysisDays"),
    metricDefaults: {
      minimumSampleSize: form.watch("metricDefaults.minimumSampleSize"),
      maxPercentageChange: form.watch("metricDefaults.maxPercentageChange"),
      minPercentageChange: form.watch("metricDefaults.minPercentageChange"),
    },
    // customization:
    customized: form.watch("customized"),
    logoPath: form.watch("logoPath"),
    primaryColor: form.watch("primaryColor"),
    secondaryColor: form.watch("secondaryColor"),
    northStar: form.watch("northStar"),
    updateSchedule: form.watch("updateSchedule"),
    runHealthTrafficQuery: form.watch("runHealthTrafficQuery"),
    srmThreshold: form.watch("srmThreshold"),
    multipleExposureMinPercent: form.watch("multipleExposureMinPercent"),
    statsEngine: form.watch("statsEngine"),
    confidenceLevel: form.watch("confidenceLevel"),
    pValueThreshold: form.watch("pValueThreshold"),
    pValueCorrection: form.watch("pValueCorrection"),
    regressionAdjustmentEnabled: form.watch("regressionAdjustmentEnabled"),
    regressionAdjustmentDays: form.watch("regressionAdjustmentDays"),
    sequentialTestingEnabled: form.watch("sequentialTestingEnabled"),
    sequentialTestingTuningParameter: form.watch(
      "sequentialTestingTuningParameter"
    ),
    attributionModel: form.watch("attributionModel"),
    displayCurrency: form.watch("displayCurrency"),
    secureAttributeSalt: form.watch("secureAttributeSalt"),
    killswitchConfirmation: form.watch("killswitchConfirmation"),
    defaultDataSource: form.watch("defaultDataSource"),
    useStickyBucketing: form.watch("useStickyBucketing"),
    useFallbackAttributes: form.watch("useFallbackAttributes"),
    codeReferencesEnabled: form.watch("codeReferencesEnabled"),
    codeRefsBranchesToFilter: form.watch("codeRefsBranchesToFilter"),
    codeRefsPlatformUrl: form.watch("codeRefsPlatformUrl"),
  };
  function updateCronString(cron?: string) {
    cron = cron || value.updateSchedule?.cron || "";

    if (!cron) {
      setCronString("");
    }
    setCronString(
      `${cronstrue.toString(cron, {
        throwExceptionOnParseError: false,
        verbose: true,
      })} (UTC time)`
    );
  }

  useEffect(() => {
    if (settings) {
      const newVal = { ...form.getValues() };
      Object.keys(newVal).forEach((k) => {
        const hasExistingMetrics = typeof settings?.[k] !== "undefined";
        newVal[k] = settings?.[k] || newVal[k];

        // Existing values are stored as a multiplier, e.g. 50% on the UI is stored as 0.5
        // Transform these values from the UI format
        if (k === "metricDefaults" && hasExistingMetrics) {
          newVal.metricDefaults = {
            ...newVal.metricDefaults,
            maxPercentageChange:
              newVal.metricDefaults.maxPercentageChange * 100,
            minPercentageChange:
              newVal.metricDefaults.minPercentageChange * 100,
          };
        }
        if (k === "confidenceLevel" && (newVal?.confidenceLevel ?? 0.95) <= 1) {
          newVal.confidenceLevel = (newVal.confidenceLevel ?? 0.95) * 100;
        }
        if (
          k === "multipleExposureMinPercent" &&
          (newVal?.multipleExposureMinPercent ?? 0.01) <= 1
        ) {
          newVal.multipleExposureMinPercent =
            (newVal.multipleExposureMinPercent ?? 0.01) * 100;
        }

        if (k === "useStickyBucketing") {
          newVal.useStickyBucketing = hasStickyBucketFeature
            ? newVal.useStickyBucketing
            : false;
        }
      });
      form.reset(newVal);
      setOriginalValue(newVal);
      updateCronString(newVal.updateSchedule?.cron || "");
      if (newVal.codeRefsBranchesToFilter) {
        setCodeRefsBranchesToFilterStr(
          newVal.codeRefsBranchesToFilter.join(", ")
        );
      }
    }
  }, [settings]);

  useEffect(() => {
    form.setValue(
      "codeRefsBranchesToFilter",
      codeRefsBranchesToFilterStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }, [codeRefsBranchesToFilterStr]);

  const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
    const transformedOrgSettings = {
      ...value,
      metricDefaults: {
        ...value.metricDefaults,
        maxPercentageChange: value.metricDefaults.maxPercentageChange / 100,
        minPercentageChange: value.metricDefaults.minPercentageChange / 100,
      },
      confidenceLevel: (value.confidenceLevel ?? 0.95) / 100,
      multipleExposureMinPercent:
        (value.multipleExposureMinPercent ?? 0.01) / 100,
    };

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: transformedOrgSettings,
      }),
    });
    refreshOrganization();

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  return (
    <FormProvider {...form}>
      <div className="container-fluid pagecontents">
        <h1>General Settings</h1>

        <div className="mb-1">
          <OrganizationAndLicenseSettings
            org={organization}
            refreshOrg={refreshOrganization}
          />

          <ImportSettings
            hasFileConfig={hasFileConfig()}
            isCloud={isCloud()}
            settings={settings}
            refreshOrg={refreshOrganization}
          />

          <NorthStarMetricSettings />

          <div className="bg-white p-3 border position-relative">
            <ExperimentSettings
              cronString={cronString}
              updateCronString={updateCronString}
              hasCommercialFeature={hasCommercialFeature}
            />

            <div className="divider border-bottom mb-3 mt-3" />

            <MetricsSettings />

            <div className="divider border-bottom mb-3 mt-3" />

            <FeaturesSettings />

            <div className="divider border-bottom mb-3 mt-3" />

            <div className="row">
              <div className="col-sm-3">
                <h4>Data Source Settings</h4>
              </div>
              <div className="col-sm-9">
                <>
                  <SelectField
                    label="Default Data Source (Optional)"
                    value={form.watch("defaultDataSource") || ""}
                    options={datasources.map((d) => ({
                      label: d.name,
                      value: d.id,
                    }))}
                    onChange={(v: string) =>
                      form.setValue("defaultDataSource", v)
                    }
                    isClearable={true}
                    placeholder="Select a data source..."
                    helpText="The default data source is the default data source selected when creating metrics and experiments."
                  />
                </>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0, height: 70 }}
      >
        <div className="container-fluid pagecontents d-flex">
          <div className="flex-grow-1 mr-4">
            {saveMsg && (
              <TempMessage
                className="mb-0 py-2"
                close={() => {
                  setSaveMsg(false);
                }}
              >
                Settings saved
              </TempMessage>
            )}
          </div>
          <div>
            <Button
              style={{ marginRight: "4rem" }}
              color={"primary"}
              disabled={!ctaEnabled}
              onClick={async () => {
                if (!ctaEnabled) return;
                await saveSettings();
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </FormProvider>
  );
};

export default GeneralSettingsPage;
