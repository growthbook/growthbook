import cronstrue from "cronstrue";
import React, { useEffect, useState } from "react";
import { FaExclamationCircle, FaQuestionCircle } from "react-icons/fa";
import { useForm } from "react-hook-form";
import isEqual from "lodash/isEqual";
import { PValueCorrection } from "back-end/types/stats";
import {
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_REGRESSION_ADJUSTMENT_ENABLED,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { OrganizationSettings } from "@/../back-end/types/organization";
import { useAuth } from "@/services/auth";
import { hasFileConfig, isCloud } from "@/services/env";
import Field from "@/components/Forms/Field";
import TempMessage from "@/components/TempMessage";
import Button from "@/components/Button";
import {
  OrganizationSettingsWithMetricDefaults,
  useOrganizationMetricDefaults,
} from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import Toggle from "@/components/Forms/Toggle";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import SelectField from "@/components/Forms/SelectField";
import { useCurrency } from "@/hooks/useCurrency";
import { useDefinitions } from "@/services/DefinitionsContext";
import { supportedCurrencies } from "@/services/settings";
import OrganizationAndLicenseSettings from "@/components/GeneralSettings/OrganizationAndLicenseSettings";
import ImportSettings from "@/components/GeneralSettings/ImportSettings";
import NorthStarMetricSettings from "@/components/GeneralSettings/NorthStarMetricSettings";
import ExperimentSettings from "@/components/GeneralSettings/ExperimentSettings";

export const DEFAULT_SRM_THRESHOLD = 0.001;

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

  const currencyOptions = Object.entries(
    supportedCurrencies
  ).map(([value, label]) => ({ value, label }));

  const permissions = usePermissions();
  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialTestingFeature = hasCommercialFeature(
    "sequential-testing"
  );
  const hasSecureAttributesFeature = hasCommercialFeature(
    "hash-secure-attributes"
  );
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");

  const hasCustomChecklistFeature = hasCommercialFeature(
    "custom-launch-checklist"
  );
  const hasCodeReferencesFeature = hasCommercialFeature("code-references");

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

  const metricAnalysisDaysWarningMsg =
    value.metricAnalysisDays && value.metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";

  if (!permissions.organizationSettings) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <>
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

          <NorthStarMetricSettings
            metricIds={form.watch("northStar.metricIds")}
            onChangeMetricIds={(metricIds) =>
              form.setValue("northStar.metricIds", metricIds)
            }
            title={form.watch("northStar.title")}
            onChangeTitle={(title) => form.setValue("northStar.title", title)}
          />

          <div className="bg-white p-3 border position-relative">
            <ExperimentSettings
              cronString={cronString}
              updateCronString={updateCronString}
              hasFileConfig={hasFileConfig()}
              hasCommercialFeature={hasCommercialFeature}
              pastExperimentsMinLengthField={form.register(
                "pastExperimentsMinLength",
                {
                  valueAsNumber: true,
                  min: 0,
                  max: 31,
                }
              )}
              multipleExposureMinPercentField={form.register(
                "multipleExposureMinPercent",
                {
                  valueAsNumber: true,
                  min: 0,
                  max: 100,
                }
              )}
              attributionModel={form.watch("attributionModel")}
              setAttributionModel={(v) => form.setValue("attributionModel", v)}
              updateSchedule={form.watch("updateSchedule")}
              updateScheduleTypeField={form.register("updateSchedule.type")}
              updateScheduleHoursField={form.register("updateSchedule.hours")}
              updateScheduleCronField={form.register("updateSchedule.cron")}
              disableMultiMetricQueries={form.watch(
                "disableMultiMetricQueries"
              )}
              setDisableMultiMetricQueries={(v: boolean) =>
                form.setValue("disableMultiMetricQueries", v)
              }
              statsEngine={form.watch("statsEngine")}
              setStatsEngine={(v) => form.setValue("statsEngine", v)}
              confidenceLevel={form.watch("confidenceLevel")}
              confidenceLevelField={form.register("confidenceLevel", {
                valueAsNumber: true,
                min: 50,
                max: 100,
              })}
              pValueThreshold={form.watch("pValueThreshold")}
              pValueThresholdField={form.register("pValueThreshold", {
                valueAsNumber: true,
                min: 0,
                max: 1,
              })}
              pValueCorrection={form.watch("pValueCorrection")}
              setPValueCorrection={(v: PValueCorrection) =>
                form.setValue("pValueCorrection", v)
              }
              regressionAdjustmentEnabled={form.watch(
                "regressionAdjustmentEnabled"
              )}
              setRegressionAdjustmentEnabled={(v: boolean) =>
                form.setValue("regressionAdjustmentEnabled", v)
              }
              regressionAdjustmentDays={form.watch("regressionAdjustmentDays")}
              hasRegressionAdjustmentFeature={hasRegressionAdjustmentFeature}
              regressionAdjustmentDaysField={form.register(
                "regressionAdjustmentDays",
                {
                  valueAsNumber: true,
                  validate: (v) => {
                    // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
                    return !(v <= 0 || v > 100);
                  },
                }
              )}
              sequentialTestingEnabled={form.watch("sequentialTestingEnabled")}
              setSequentialTestingEnabled={(v: boolean) =>
                form.setValue("sequentialTestingEnabled", v)
              }
              hasSequentialTestingFeature={hasSequentialTestingFeature}
              sequentialTestingTuningParameterField={form.register(
                "sequentialTestingTuningParameter",
                {
                  valueAsNumber: true,
                  validate: (v) => {
                    return !(v <= 0);
                  },
                }
              )}
              useStickyBucketing={form.watch("useStickyBucketing")}
              setUseStickyBucketing={(v: boolean) =>
                form.setValue("useStickyBucketing", v)
              }
              hasStickyBucketFeature={hasStickyBucketFeature}
              useFallbackAttributes={form.watch("useFallbackAttributes")}
              setUseFallbackAttributes={(v: boolean) =>
                form.setValue("useFallbackAttributes", v)
              }
              runHealthTrafficQuery={form.watch("runHealthTrafficQuery")}
              setRunHealthTrafficQuery={(v: boolean) =>
                form.setValue("runHealthTrafficQuery", v)
              }
              srmThreshold={form.watch("srmThreshold")}
              srmThresholdField={form.register("srmThreshold", {
                valueAsNumber: true,
                min: 0,
                max: 1,
              })}
              hasCustomChecklistFeature={hasCustomChecklistFeature}
            />

            <div className="divider border-bottom mb-3 mt-3" />

            <div className="row">
              <div className="col-sm-3">
                <h4>Metrics Settings</h4>
              </div>
              <div className="col-sm-9">
                <div className="form-inline">
                  <Field
                    label="Amount of historical data to use on metric analysis page"
                    type="number"
                    append="days"
                    className="ml-2"
                    containerClassName="mb-0"
                    disabled={hasFileConfig()}
                    {...form.register("metricAnalysisDays", {
                      valueAsNumber: true,
                    })}
                  />
                  {metricAnalysisDaysWarningMsg && (
                    <small className="text-danger">
                      {metricAnalysisDaysWarningMsg}
                    </small>
                  )}
                </div>

                {/* region Metrics Behavior Defaults */}
                <>
                  <h5 className="mt-4">Metrics Behavior Defaults</h5>
                  <p>
                    These are the pre-configured default values that will be
                    used when configuring metrics. You can always change these
                    values on a per-metric basis.
                  </p>

                  {/* region Minimum Sample Size */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Minimum Sample Size"
                        type="number"
                        min={0}
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register("metricDefaults.minimumSampleSize", {
                          valueAsNumber: true,
                          min: 0,
                        })}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        The total count required in an experiment variation
                        before showing results
                      </small>
                    </p>
                  </div>
                  {/* endregion Minimum Sample Size */}

                  {/* region Maximum Percentage Change */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Maximum Percentage Change"
                        type="number"
                        min={0}
                        append="%"
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register(
                          "metricDefaults.maxPercentageChange",
                          {
                            valueAsNumber: true,
                            min: 0,
                          }
                        )}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        An experiment that changes the metric by more than this
                        percent will be flagged as suspicious
                      </small>
                    </p>
                  </div>
                  {/* endregion Maximum Percentage Change */}

                  {/* region Minimum Percentage Change */}
                  <div>
                    <div className="form-inline">
                      <Field
                        label="Minimum Percentage Change"
                        type="number"
                        min={0}
                        append="%"
                        className="ml-2"
                        containerClassName="mt-2"
                        disabled={hasFileConfig()}
                        {...form.register(
                          "metricDefaults.minPercentageChange",
                          {
                            valueAsNumber: true,
                            min: 0,
                          }
                        )}
                      />
                    </div>
                    <p>
                      <small className="text-muted mb-3">
                        An experiment that changes the metric by less than this
                        percent will be considered a draw
                      </small>
                    </p>
                  </div>
                  {/* endregion Minimum Percentage Change */}
                </>
                {/* endregion Metrics Behavior Defaults */}
                <>
                  <SelectField
                    label="Display Currency"
                    value={form.watch("displayCurrency") || "USD"}
                    options={currencyOptions}
                    onChange={(v: string) =>
                      form.setValue("displayCurrency", v)
                    }
                    required
                    placeholder="Select currency..."
                    helpText="This should match what is stored in the data source and controls what currency symbol is displayed."
                  />
                </>
              </div>
            </div>

            <div className="divider border-bottom mb-3 mt-3" />

            <div className="row">
              <div className="col-sm-3">
                <h4>Features Settings</h4>
              </div>
              <div className="col-sm-9">
                <div className="form-inline">
                  <Field
                    label={
                      <PremiumTooltip
                        commercialFeature="hash-secure-attributes"
                        body={
                          <>
                            <p>
                              Feature targeting conditions referencing{" "}
                              <code>secureString</code> attributes will be
                              anonymized via SHA-256 hashing. When evaluating
                              feature flags in a public or insecure environment
                              (such as a browser), hashing provides an
                              additional layer of security through obfuscation.
                              This allows you to target users based on sensitive
                              attributes.
                            </p>
                            <p>
                              You must enable this feature in your SDK
                              Connection for it to take effect.
                            </p>
                            <p>
                              You may add a cryptographic salt string (a random
                              string of your choosing) to the hashing algorithm,
                              which helps defend against hash lookup
                              vulnerabilities.
                            </p>
                            <p className="mb-0 text-warning-orange small">
                              <FaExclamationCircle /> When using an insecure
                              environment, do not rely exclusively on hashing as
                              a means of securing highly sensitive data. Hashing
                              is an obfuscation technique that makes it very
                              difficult, but not impossible, to extract
                              sensitive data.
                            </p>
                          </>
                        }
                      >
                        Salt string for secure attributes <FaQuestionCircle />
                      </PremiumTooltip>
                    }
                    disabled={!hasSecureAttributesFeature}
                    className="ml-2"
                    containerClassName="mb-3"
                    type="string"
                    {...form.register("secureAttributeSalt")}
                  />
                </div>

                <div>
                  <label
                    className="mr-1"
                    htmlFor="toggle-killswitchConfirmation"
                  >
                    Require confirmation when changing an environment kill
                    switch
                  </label>
                </div>
                <div>
                  <Toggle
                    id={"toggle-killswitchConfirmation"}
                    value={!!form.watch("killswitchConfirmation")}
                    setValue={(value) => {
                      form.setValue("killswitchConfirmation", value);
                    }}
                  />
                </div>
                <div className="my-3">
                  <PremiumTooltip commercialFeature={"code-references"}>
                    <div
                      className="d-inline-block h4 mt-4 mb-0"
                      id="configure-code-refs"
                    >
                      Configure Code References
                    </div>
                  </PremiumTooltip>
                  <div>
                    <label className="mr-1" htmlFor="toggle-codeReferences">
                      Enable displaying code references for feature flags in the
                      GrowthBook UI
                    </label>
                  </div>
                  <div className="my-2">
                    <Toggle
                      id={"toggle-codeReferences"}
                      value={!!form.watch("codeReferencesEnabled")}
                      setValue={(value) => {
                        form.setValue("codeReferencesEnabled", value);
                      }}
                      disabled={!hasCodeReferencesFeature}
                    />
                  </div>
                  {form.watch("codeReferencesEnabled") ? (
                    <>
                      <div className="my-4">
                        <h4>Code References Setup</h4>
                        <div className="appbox my-4 p-3">
                          <div className="row">
                            <div className="col-sm-9">
                              <strong>For GitHub Users</strong>
                              <p className="my-2">
                                Use our all-in-one GitHub Action to integrate
                                GrowthBook into your CI workflow.
                              </p>
                            </div>
                            <div className="col-sm-3 text-right">
                              <a
                                href="https://github.com/marketplace/actions/growthbook-code-references"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Setup
                              </a>
                            </div>
                          </div>
                        </div>

                        <div className="appbox my-4 p-3">
                          <div className="row">
                            <div className="col-sm-9">
                              <strong>For Non-GitHub Users</strong>
                              <p className="my-2">
                                Use our CLI utility that takes in a list of
                                feature keys and scans your codebase to provide
                                a JSON output of code references, which you can
                                supply to our code references{" "}
                                <a
                                  href="https://docs.growthbook.io/api#tag/code-references"
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  REST API endpoint
                                </a>
                                .
                              </p>
                            </div>
                            <div className="col-sm-3 text-right">
                              <a
                                href="https://github.com/growthbook/gb-find-code-refs"
                                target="_blank"
                                rel="noreferrer"
                              >
                                CLI Utility
                              </a>{" "}
                              |{" "}
                              <a
                                href="https://hub.docker.com/r/growthbook/gb-find-code-refs"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Docker Image
                              </a>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="my-4">
                        <strong>
                          Only show code refs from the following branches
                          (comma-separated, optional):
                        </strong>
                        <Field
                          className="my-2"
                          type="text"
                          placeholder="main, qa, dev"
                          value={codeRefsBranchesToFilterStr}
                          onChange={(v) => {
                            const branches = v.currentTarget.value;
                            setCodeRefsBranchesToFilterStr(branches);
                          }}
                        />
                      </div>

                      <div className="my-4">
                        <strong>
                          Platform (to allow direct linking, optional):
                        </strong>
                        <div className="d-flex">
                          <SelectField
                            className="my-2"
                            value={form.watch("codeRefsPlatformUrl") || ""}
                            isClearable
                            options={[
                              {
                                label: "GitHub",
                                value: "https://github.com",
                              },
                              {
                                label: "GitLab",
                                value: "https://gitlab.com",
                              },
                            ]}
                            onChange={(v: string) => {
                              if (!v) form.setValue("codeRefsPlatformUrl", "");
                              else form.setValue("codeRefsPlatformUrl", v);
                            }}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
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
    </>
  );
};

export default GeneralSettingsPage;
