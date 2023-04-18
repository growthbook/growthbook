import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FaExclamationTriangle, FaQuestionCircle } from "react-icons/fa";
import isEqual from "lodash/isEqual";
import { ProjectInterface } from "back-end/types/project";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import LoadingOverlay from "@/components/LoadingOverlay";
import {
  GBCircleArrowLeft,
  GBCuped,
  GBEdit,
  GBSequential,
} from "@/components/Icons";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import { hasFileConfig } from "@/services/env";
import Button from "@/components/Button";
import TempMessage from "@/components/TempMessage";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import Toggle from "@/components/Forms/Toggle";
import { useUser } from "@/services/UserContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import ProjectModal from "@/components/Projects/ProjectModal";
import MemberList from "@/components/Settings/Team/MemberList";

// todo: use proper interface
/* eslint-disable @typescript-eslint/no-explicit-any */
type ProjectSettings = any;

function hasChanges(value: ProjectSettings, existing: ProjectSettings) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const settings: ProjectSettings = {};

const ProjectPage: FC = () => {
  const { hasCommercialFeature, refreshOrganization } = useUser();

  const { getProjectById, mutateDefinitions, ready, error } = useDefinitions();
  const { pid } = router.query as { pid: string };
  const p = getProjectById(pid);
  // const settings = p?.settings;
  // todo: replace with project settings (above)
  // const settings: ProjectSettings = {};

  // todo: use scope function to get defaults
  const orgSettings = useOrgSettings();

  // const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<ProjectSettings>({});
  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    settings.statsEngine ?? "bayesian"
  );

  const permissions = usePermissions();
  const canEditSettings = permissions.check("manageProjects", pid);
  // todo: should this also be project scoped?
  const canManageTeam = permissions.check("manageTeam");

  const hasRegressionAdjustmentFeature = hasCommercialFeature(
    "regression-adjustment"
  );
  const hasSequentialTestingFeature = hasCommercialFeature(
    "sequential-testing"
  );

  const form = useForm<ProjectSettings>({
    defaultValues: {
      multipleExposureMinPercent: settings?.multipleExposureMinPercent,
      attributionModel: settings?.attributionModel || "",
      statsEngine: settings?.statsEngine || "",
      metricDefaults: {
        minimumSampleSize: settings?.metricDefaults?.minimumSampleSize,
        maxPercentageChange: settings?.metricDefaults?.maxPercentageChange,
        minPercentageChange: settings?.metricDefaults?.minPercentageChange,
      },
      confidenceLevel: settings?.confidenceLevel,
      pValueThreshold: settings?.pValueThreshold,
      regressionAdjustmentOverride: settings?.regressionAdjustmentOverride,
      regressionAdjustmentEnabled: settings?.regressionAdjustmentEnabled,
      regressionAdjustmentDays: settings?.regressionAdjustmentDays,
      sequentialTestingOverride: settings?.sequentialTestingOverride,
      sequentialTestingEnabled: settings?.sequentialTestingEnabled,
      sequentialTestingTuningParameter:
        settings?.sequentialTestingTuningParameter,
    },
  });

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
        if (k === "confidenceLevel" && newVal?.confidenceLevel <= 1) {
          newVal.confidenceLevel = newVal.confidenceLevel * 100;
        }
      });
      form.reset(newVal);
      setOriginalValue(newVal);
    }
    //eslint-disable-next-line
  }, [settings, form]);

  const value = form.getValues();

  const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = form.handleSubmit(async (value) => {
    const transformedProjectSettings = {
      ...value,
      metrics: {
        ...value.metrics,
        maxPercentageChange: value.metrics.maxPercentageChange / 100,
        minPercentageChange: value.metrics.minPercentageChange / 100,
      },
      experiments: {
        bayesian: {
          confidenceLevel: value.experiments.bayesian.confidenceLevel / 100,
        },
      },
    };
    console.log("save", transformedProjectSettings);

    // await apiCall(`/organization`, {
    //   method: "PUT",
    //   body: JSON.stringify({
    //     settings: transformedProjectSettings,
    //   }),
    // });

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  const highlightColor =
    value.confidenceLevel < 70
      ? "#c73333"
      : value.confidenceLevel < 80
      ? "#e27202"
      : value.confidenceLevel < 90
      ? "#B39F01"
      : "";

  const pHighlightColor =
    value.pValueThreshold > 0.3
      ? "#c73333"
      : value.pValueThreshold > 0.2
      ? "#e27202"
      : value.pValueThreshold > 0.1
      ? "#B39F01"
      : "";

  const regressionAdjustmentDaysHighlightColor =
    value.regressionAdjustmentDays > 28 || value.regressionAdjustmentDays < 7
      ? "#e27202"
      : "";

  const warningMsg =
    value.confidenceLevel === 70
      ? "This is as low as it goes"
      : value.confidenceLevel < 75
      ? "Confidence thresholds this low are not recommended"
      : value.confidenceLevel < 80
      ? "Confidence thresholds this low are not recommended"
      : value.confidenceLevel < 90
      ? "Use caution with values below 90%"
      : value.confidenceLevel >= 99
      ? "Confidence levels 99% and higher can take lots of data to achieve"
      : "";

  const pWarningMsg =
    value.pValueThreshold === 0.5
      ? "This is as high as it goes"
      : value.pValueThreshold > 0.25
      ? "P-value thresholds this high are not recommended"
      : value.pValueThreshold > 0.2
      ? "P-value thresholds this high are not recommended"
      : value.pValueThreshold > 0.1
      ? "Use caution with values above 0.1"
      : value.pValueThreshold <= 0.01
      ? "Threshold values of 0.01 and lower can take lots of data to achieve"
      : "";

  const regressionAdjustmentDaysWarningMsg =
    value.regressionAdjustmentDays > 28
      ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
      : value.regressionAdjustmentDays < 7
      ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
      : "";

  if (!canEditSettings) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!p) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Project <code>{pid}</code> does not exist.
        </div>
      </div>
    );
  }

  return (
    <>
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      <div className="container pagecontents">
        <div className="mb-2">
          <Link href="/projects">
            <a>
              <GBCircleArrowLeft /> Back to all projects
            </a>
          </Link>
        </div>
        <div className="d-flex align-items-center mb-2">
          <h1 className="mb-0">{p.name}</h1>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <div className="d-flex align-items-center mb-2">
          <div className="text-gray">{p.description}</div>
          <div className="ml-1">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setModalOpen(p);
              }}
            >
              <GBEdit />
            </a>
          </div>
        </div>

        <h2 className="mt-4 mb-0">Project Team Members</h2>
        <div className="mb-4">
          <MemberList
            mutate={refreshOrganization}
            project={pid}
            canEditRoles={canManageTeam}
            canDeleteMembers={false}
            canInviteMembers={false}
            maxHeight={500}
          />
        </div>

        <h2 className="mt-4 mb-2">Project Settings</h2>
        {saveMsg && (
          <TempMessage
            close={() => {
              setSaveMsg(false);
            }}
          >
            Settings saved
          </TempMessage>
        )}
        <div className="text-muted mb-4">
          Override organization-wide settings for this project. Leave fields
          blank to use the organization default.
        </div>
        <div className="bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>Experiment Settings</h4>
            </div>
            <div className="col-sm-9">
              <div className="form-inline flex-column align-items-start">
                <Field
                  label="Warn when this percent of experiment users are in multiple variations"
                  type="number"
                  step="any"
                  min="0"
                  max="1"
                  className="ml-2"
                  containerClassName="mb-3"
                  helpText={<span className="ml-2">from 0 to 1</span>}
                  {...form.register("experiments.multipleExposureMinPercent", {
                    valueAsNumber: true,
                  })}
                />

                <SelectField
                  label={
                    <AttributionModelTooltip>
                      Default Attribution Model <FaQuestionCircle />
                    </AttributionModelTooltip>
                  }
                  className="ml-2"
                  containerClassName="mb-3"
                  sort={false}
                  options={[
                    {
                      label: "Organization default",
                      value: "",
                    },
                    {
                      label: "First Exposure",
                      value: "firstExposure",
                    },
                    {
                      label: "Experiment Duration",
                      value: "experimentDuration",
                    },
                  ]}
                  value={form.watch("experiments.attributionModel")}
                  onChange={(v) =>
                    form.setValue("experiments.attributionModel", v)
                  }
                />

                <SelectField
                  label="Statistics Engine"
                  className="ml-2"
                  containerClassName="mb-3"
                  sort={false}
                  options={[
                    {
                      label: "Organization default",
                      value: "",
                    },
                    {
                      label: "Bayesian",
                      value: "bayesian",
                    },
                    {
                      label: "Frequentist",
                      value: "frequentist",
                    },
                  ]}
                  value={form.watch("experiments.statsEngine")}
                  onChange={(v) => form.setValue("experiments.statsEngine", v)}
                />

                <h4>Stats Engine Settings</h4>

                <ControlledTabs
                  newStyle={true}
                  className="mt-3 w-100"
                  buttonsClassName="px-5"
                  tabContentsClassName="border"
                  setActive={setStatsEngineTab}
                  active={statsEngineTab}
                >
                  <Tab id="bayesian" display="Bayesian">
                    <h4 className="mb-4 text-purple">Bayesian Settings</h4>

                    <div className="form-group mb-2 mr-2 form-inline">
                      <Field
                        label="Chance to win threshold"
                        type="number"
                        step="any"
                        min="70"
                        max="99"
                        style={{
                          width: "80px",
                          borderColor: highlightColor,
                          backgroundColor: highlightColor
                            ? highlightColor + "15"
                            : "",
                        }}
                        className={`ml-2`}
                        containerClassName="mb-3"
                        append="%"
                        disabled={hasFileConfig()}
                        helpText={
                          <>
                            <span className="ml-2">(95% is default)</span>
                            <div
                              className="ml-2"
                              style={{
                                color: highlightColor,
                                flexBasis: "100%",
                              }}
                            >
                              {warningMsg}
                            </div>
                          </>
                        }
                        {...form.register("confidenceLevel", {
                          valueAsNumber: true,
                        })}
                      />
                    </div>
                  </Tab>

                  <Tab id="frequentist" display="Frequentist">
                    <h4 className="mb-4 text-purple">Frequentist Settings</h4>

                    <div className="form-group mb-2 mr-2 form-inline">
                      <Field
                        label="P-value threshold"
                        type="number"
                        step="0.001"
                        max="0.5"
                        min="0.001"
                        style={{
                          borderColor: pHighlightColor,
                          backgroundColor: pHighlightColor
                            ? pHighlightColor + "15"
                            : "",
                        }}
                        className={`ml-2`}
                        containerClassName="mb-3"
                        append=""
                        disabled={hasFileConfig()}
                        helpText={
                          <>
                            <span className="ml-2">(0.05 is default)</span>
                            <div
                              className="ml-2"
                              style={{
                                color: pHighlightColor,
                                flexBasis: "100%",
                              }}
                            >
                              {pWarningMsg}
                            </div>
                          </>
                        }
                        {...form.register("pValueThreshold", {
                          valueAsNumber: true,
                        })}
                      />
                    </div>

                    <div className="p-3 my-3 border rounded">
                      <h5 className="font-weight-bold mb-3">
                        <PremiumTooltip commercialFeature="regression-adjustment">
                          <GBCuped /> Regression Adjustment (CUPED)
                        </PremiumTooltip>
                      </h5>
                      <div className="form-group form-inline">
                        <label className="cursor-pointer">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            {...form.register("regressionAdjustmentOverride")}
                          />
                          Override organization-level settings
                        </label>
                      </div>
                      {!!form.watch("regressionAdjustmentOverride") && (
                        <>
                          <div className="d-flex my-3 border-bottom"></div>
                          <div className="form-group mt-2 mr-2">
                            <div className="d-flex">
                              <label
                                className="mr-1"
                                htmlFor="toggle-regressionAdjustmentEnabled"
                              >
                                Apply regression adjustment by default
                              </label>
                              <Toggle
                                id={"toggle-regressionAdjustmentEnabled"}
                                value={
                                  !!form.watch("regressionAdjustmentEnabled")
                                }
                                setValue={(value) => {
                                  form.setValue(
                                    "regressionAdjustmentEnabled",
                                    value
                                  );
                                }}
                                disabled={
                                  !hasRegressionAdjustmentFeature ||
                                  hasFileConfig()
                                }
                              />
                              <small className="form-text text-muted">
                                (organization default:{" "}
                                {orgSettings.regressionAdjustmentEnabled
                                  ? "On"
                                  : "Off"}
                                )
                              </small>
                            </div>
                            {form.watch("regressionAdjustmentEnabled") &&
                              form.watch("statsEngine") === "bayesian" && (
                                <div className="d-flex">
                                  <small className="mb-1 text-warning-orange">
                                    <FaExclamationTriangle /> Your organization
                                    uses Bayesian statistics by default and
                                    regression adjustment is not implemented for
                                    the Bayesian engine.
                                  </small>
                                </div>
                              )}
                          </div>
                          <div
                            className="form-group mt-3 mb-0 mr-2 form-inline"
                            style={{
                              opacity: form.watch("regressionAdjustmentEnabled")
                                ? "1"
                                : "0.5",
                            }}
                          >
                            <Field
                              label="Pre-exposure lookback period (days)"
                              type="number"
                              style={{
                                borderColor: regressionAdjustmentDaysHighlightColor,
                                backgroundColor: regressionAdjustmentDaysHighlightColor
                                  ? regressionAdjustmentDaysHighlightColor +
                                    "15"
                                  : "",
                              }}
                              className={`ml-2`}
                              containerClassName="mb-0"
                              append="days"
                              min="0"
                              max="100"
                              disabled={
                                !hasRegressionAdjustmentFeature ||
                                hasFileConfig()
                              }
                              helpText={
                                <>
                                  <span className="ml-2 form-text text-muted">
                                    (organization default:{" "}
                                    {orgSettings.regressionAdjustmentDays})
                                  </span>
                                </>
                              }
                              {...form.register("regressionAdjustmentDays", {
                                valueAsNumber: true,
                                validate: (v) => {
                                  return !(v <= 0 || v > 100);
                                },
                              })}
                            />
                            {regressionAdjustmentDaysWarningMsg && (
                              <small
                                style={{
                                  color: regressionAdjustmentDaysHighlightColor,
                                }}
                              >
                                {regressionAdjustmentDaysWarningMsg}
                              </small>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="p-3 my-3 border rounded">
                      <h5 className="font-weight-bold mb-3">
                        <PremiumTooltip commercialFeature="sequential-testing">
                          <GBSequential /> Sequential Testing
                        </PremiumTooltip>
                      </h5>
                      <div className="form-group form-inline">
                        <label className="cursor-pointer">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            {...form.register("sequentialTestingOverride")}
                          />
                          Override organization-level settings
                        </label>
                      </div>
                      {!!form.watch("sequentialTestingOverride") && (
                        <>
                          <div className="d-flex my-3 border-bottom"></div>
                          <div className="form-group mt-2 mr-2">
                            <div className="d-flex">
                              <label
                                className="mr-1"
                                htmlFor="toggle-sequentialTestingEnabled"
                              >
                                Apply sequential testing by default
                              </label>
                              <Toggle
                                id={"toggle-sequentialTestingEnabled"}
                                value={!!form.watch("sequentialTestingEnabled")}
                                setValue={(value) => {
                                  form.setValue(
                                    "sequentialTestingEnabled",
                                    value
                                  );
                                }}
                                disabled={
                                  !hasSequentialTestingFeature ||
                                  hasFileConfig()
                                }
                              />
                              <small className="form-text text-muted">
                                (organization default:{" "}
                                {orgSettings.sequentialTestingEnabled
                                  ? "On"
                                  : "Off"}
                                )
                              </small>
                            </div>
                            {form.watch("sequentialTestingEnabled") &&
                              form.watch("statsEngine") === "bayesian" && (
                                <div className="d-flex">
                                  <small className="mb-1 text-warning-orange">
                                    <FaExclamationTriangle /> Your organization
                                    uses Bayesian statistics by default and
                                    sequential testing is not implemented for
                                    the Bayesian engine.
                                  </small>
                                </div>
                              )}
                          </div>
                          <div
                            className="form-group mt-3 mb-0 mr-2 form-inline"
                            style={{
                              opacity: form.watch("sequentialTestingEnabled")
                                ? "1"
                                : "0.5",
                            }}
                          >
                            <Field
                              label="Tuning parameter"
                              type="number"
                              className={`ml-2`}
                              containerClassName="mb-0"
                              min="0"
                              disabled={
                                !hasSequentialTestingFeature || hasFileConfig()
                              }
                              helpText={
                                <>
                                  <span className="ml-2 form-text text-muted">
                                    (organization default:{" "}
                                    {
                                      orgSettings.sequentialTestingTuningParameter
                                    }
                                    )
                                  </span>
                                </>
                              }
                              {...form.register(
                                "sequentialTestingTuningParameter",
                                {
                                  valueAsNumber: true,
                                  validate: (v) => {
                                    return !(v <= 0);
                                  },
                                }
                              )}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </Tab>
                </ControlledTabs>
              </div>
            </div>
          </div>

          <div className="divider border-bottom mb-3 mt-3"></div>

          <div className="row">
            <div className="col-sm-3">
              <h4>Metrics Settings</h4>
            </div>
            <div className="col-sm-9">
              <>
                <h5>Metrics Behavior Defaults</h5>
                <p>
                  These are the pre-configured default values that will be used
                  when configuring metrics. You can always change these values
                  on a per-metric basis.
                </p>

                <div>
                  <div className="form-inline">
                    <Field
                      label="Minimum Sample Size"
                      type="number"
                      className="ml-2"
                      containerClassName="mt-2"
                      disabled={hasFileConfig()}
                      {...form.register(
                        "metrics.metricDefaults.minimumSampleSize",
                        {
                          valueAsNumber: true,
                        }
                      )}
                    />
                  </div>
                  <p>
                    <small className="text-muted mb-3">
                      The total count required in an experiment variation before
                      showing results
                    </small>
                  </p>
                </div>

                <div>
                  <div className="form-inline">
                    <Field
                      label="Maximum Percentage Change"
                      type="number"
                      append="%"
                      className="ml-2"
                      containerClassName="mt-2"
                      disabled={hasFileConfig()}
                      {...form.register(
                        "metrics.metricDefaults.maxPercentageChange",
                        {
                          valueAsNumber: true,
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

                <div>
                  <div className="form-inline">
                    <Field
                      label="Minimum Percentage Change"
                      type="number"
                      append="%"
                      className="ml-2"
                      containerClassName="mt-2"
                      disabled={hasFileConfig()}
                      {...form.register(
                        "metrics.metricDefaults.minPercentageChange",
                        {
                          valueAsNumber: true,
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
              </>
            </div>
          </div>
        </div>
      </div>

      <div
        className="bg-main-color position-sticky w-100 py-3 border-top"
        style={{ bottom: 0 }}
      >
        <div className="container-fluid pagecontents d-flex flex-row-reverse">
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
    </>
  );
};

export default ProjectPage;
