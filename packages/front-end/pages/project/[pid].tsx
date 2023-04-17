import React, { FC, useEffect, useState } from "react";
import router from "next/router";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { FaQuestionCircle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissions from "@/hooks/usePermissions";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBCircleArrowLeft } from "@/components/Icons";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import { hasFileConfig } from "@/services/env";
import Button from "@/components/Button";
import isEqual from "lodash/isEqual";
import { useAuth } from "@/services/auth";
import TempMessage from "@/components/TempMessage";

// todo: use proper interface
/* eslint-disable @typescript-eslint/no-explicit-any */
type ProjectSettings = any;

function hasChanges(
  value: ProjectSettings,
  existing: ProjectSettings
) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const ProjectPage: FC = () => {
  const {
    getProjectById,
    // mutateDefinitions,
    ready,
    error,
  } = useDefinitions();
  const { pid } = router.query as { pid: string };
  const p = getProjectById(pid);
  // const settings = p?.settings;
  // todo: replace with project settings (above)
  const settings: ProjectSettings = {};

  const { apiCall } = useAuth();

  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<ProjectSettings>({});
  
  const permissions = usePermissions();
  const canEdit = permissions.check("manageProjects", pid);

  const form = useForm<ProjectSettings>({
    defaultValues: {
      experiments: {
        multipleExposureMinPercent: settings?.multipleExposureMinPercent,
        attributionModel: settings?.attributionModel || "",
        statsEngine: settings?.statsEngine || "",
      },
      metrics: {
        minimumSampleSize: settings?.metricsettings?.minimumSampleSize,
        maxPercentageChange: settings?.metricsettings?.maxPercentageChange,
        minPercentageChange: settings?.metricsettings?.minPercentageChange,
      }
    },
  });

  // useEffect(() => {
  //   if (settings) {
  //     const newVal = { ...form.getValues() };
  //     Object.keys(newVal).forEach((k) => {
  //       const hasExistingMetrics = typeof settings?.[k] !== "undefined";
  //       newVal[k] = settings?.[k] || newVal[k];
  //
  //       // Existing values are stored as a multiplier, e.g. 50% on the UI is stored as 0.5
  //       // Transform these values from the UI format
  //       if (k === "metrics" && hasExistingMetrics) {
  //         newVal.metrics = {
  //           ...newVal.metrics,
  //           maxPercentageChange:
  //             newVal.metrics.maxPercentageChange * 100,
  //           minPercentageChange:
  //             newVal.metrics.minPercentageChange * 100,
  //         };
  //       }
  //       if (k === "confidenceLevel" && newVal?.confidenceLevel <= 1) {
  //         newVal.confidenceLevel = newVal.confidenceLevel * 100;
  //       }
  //     });
  //     form.reset(newVal);
  //     setOriginalValue(newVal);
  //   }
  // }, [settings]);

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
        }
      }
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

  if (!canEdit) {
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
    <div className="container pagecontents">
      <div className="mb-2">
        <Link href="/projects">
          <a>
            <GBCircleArrowLeft /> Back to all projects
          </a>
        </Link>
      </div>
      <div className="row mb-2 align-items-center">
        <div className="col-auto">
          <h1 className="mb-0">{p.name}</h1>
        </div>
      </div>
      <div className="row mt-1 mb-3 align-items-center">
        <div className="col-auto">
          <div className="text-gray">{p.description}</div>
        </div>
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
        Override organization-wide settings for this project. Leave fields blank
        to use the organization default.
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
                onChange={(v) => form.setValue("experiments.attributionModel", v)}
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
                These are the pre-configured default values that will be
                used when configuring metrics. You can always change these
                values on a per-metric basis.
              </p>

              <div>
                <div className="form-inline">
                  <Field
                    label="Minimum Sample Size"
                    type="number"
                    className="ml-2"
                    containerClassName="mt-2"
                    disabled={hasFileConfig()}
                    {...form.register("metrics.minimumSampleSize", {
                      valueAsNumber: true,
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
                      "metrics.maxPercentageChange",
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
                      "metrics.minPercentageChange",
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
              // await saveSettings();
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectPage;
