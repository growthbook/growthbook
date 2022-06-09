import React, { useEffect, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { useAuth } from "../../services/auth";
import { FaCheck, FaPencilAlt } from "react-icons/fa";
import EditOrganizationForm from "../../components/Settings/EditOrganizationForm";
import { useForm } from "react-hook-form";
import { ApiKeyInterface } from "back-end/types/apikey";
import VisualEditorInstructions from "../../components/Settings/VisualEditorInstructions";
import track from "../../services/track";
import BackupConfigYamlButton from "../../components/Settings/BackupConfigYamlButton";
import RestoreConfigYamlButton from "../../components/Settings/RestoreConfigYamlButton";
import { hasFileConfig, isCloud } from "../../services/env";
import { OrganizationSettings, MemberRole } from "back-end/types/organization";
import isEqual from "lodash/isEqual";
import Field from "../../components/Forms/Field";
import MetricsSelector from "../../components/Experiment/MetricsSelector";
import cronstrue from "cronstrue";
import TempMessage from "../../components/TempMessage";
import Button from "../../components/Button";

export type SettingsApiResponse = {
  status: number;
  apiKeys: ApiKeyInterface[];
  organization?: {
    invites: {
      email: string;
      key: string;
      role: MemberRole;
      dateCreated: string;
    }[];
    ownerEmail: string;
    name: string;
    url: string;
    members: {
      id: string;
      email: string;
      name: string;
      role: MemberRole;
    }[];
    subscription?: {
      id: string;
      qty: number;
      trialEnd: Date;
      status:
        | "incomplete"
        | "incomplete_expired"
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "unpaid";
    };
    slackTeam?: string;
    settings?: OrganizationSettings;
  };
};

function hasChanges(
  value: OrganizationSettings,
  existing: OrganizationSettings
) {
  if (!existing) return true;

  return !isEqual(value, existing);
}

const GeneralSettingsPage = (): React.ReactElement => {
  const { data, error, mutate } = useApi<SettingsApiResponse>(`/organization`);
  const [editOpen, setEditOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState(false);
  const [originalValue, setOriginalValue] = useState<OrganizationSettings>({});

  // eslint-disable-next-line
  const form = useForm<OrganizationSettings>({
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
      updateSchedule: {
        type: "stale",
        hours: 6,
        cron: "0 */6 * * *",
      },
      multipleExposureMinPercent: 0.01,
    },
  });
  const { apiCall, organizations, setOrganizations, orgId } = useAuth();

  const value = {
    visualEditorEnabled: form.watch("visualEditorEnabled"),
    pastExperimentsMinLength: form.watch("pastExperimentsMinLength"),
    metricAnalysisDays: form.watch("metricAnalysisDays"),
    // customization:
    customized: form.watch("customized"),
    logoPath: form.watch("logoPath"),
    primaryColor: form.watch("primaryColor"),
    secondaryColor: form.watch("secondaryColor"),
    northStar: form.watch("northStar"),
    updateSchedule: form.watch("updateSchedule"),
    multipleExposureMinPercent: form.watch("multipleExposureMinPercent"),
  };

  const [cronString, setCronString] = useState("");

  function updateCronString(cron?: string) {
    cron = cron || value.updateSchedule?.cron || "";

    if (!cron) {
      setCronString("");
    }
    setCronString(
      cronstrue.toString(cron, {
        throwExceptionOnParseError: false,
      })
    );
  }

  useEffect(() => {
    if (data?.organization?.settings) {
      const newVal = { ...form.getValues() };
      Object.keys(newVal).forEach((k) => {
        newVal[k] = data.organization.settings?.[k] || newVal[k];
      });
      form.reset(newVal);
      setOriginalValue(newVal);
      updateCronString(newVal.updateSchedule?.cron || "");
    }
  }, [data?.organization?.settings]);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const ctaEnabled = hasChanges(value, originalValue);

  const saveSettings = async () => {
    const enabledVisualEditor =
      !data?.organization?.settings?.visualEditorEnabled &&
      value.visualEditorEnabled;

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: value,
      }),
    });
    await mutate();
    organizations.forEach((org) => {
      if (org.id === orgId) {
        org.settings = value;
      }
    });
    setOrganizations(organizations);

    // Track usage of the Visual Editor
    if (enabledVisualEditor) {
      track("Enable Visual Editor");
    }

    // show the user that the settings have saved:
    setSaveMsg(true);
  };

  return (
    <div className="container-fluid pagecontents">
      {saveMsg && (
        <TempMessage
          close={() => {
            setSaveMsg(false);
          }}
        >
          Settings saved
        </TempMessage>
      )}
      {editOpen && (
        <EditOrganizationForm
          name={data.organization.name}
          close={() => setEditOpen(false)}
          mutate={mutate}
        />
      )}
      <h1>General Settings</h1>
      <div className="mb-1">
        <div className=" bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>Organization</h4>
            </div>
            <div className="col-sm-9">
              <div className="form-group row">
                <div className="col-sm-12">
                  <strong>Name: </strong> {data.organization.name}{" "}
                  <a
                    href="#"
                    className="pl-1"
                    onClick={(e) => {
                      e.preventDefault();
                      setEditOpen(true);
                    }}
                  >
                    <FaPencilAlt />
                  </a>
                </div>
              </div>
              <div className="form-group row">
                <div className="col-sm-12">
                  <strong>Owner:</strong> {data.organization.ownerEmail}
                </div>
              </div>
              {data.organization.slackTeam && (
                <div className="form-group row">
                  <div
                    className="col-sm-12"
                    title={"Team: " + data.organization.slackTeam}
                  >
                    <FaCheck /> Connected to Slack
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="my-3 bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>North Star Metrics</h4>
            </div>
            <div className="col-sm-9">
              <p>
                North stars are metrics your team is focused on improving. These
                metrics are shown on the home page with the experiments that
                have the metric as a goal.
              </p>
              <div className={"form-group"}>
                <div className="my-3">
                  <div className="form-group">
                    <label>Metric(s)</label>
                    <MetricsSelector
                      selected={form.watch("northStar.metricIds")}
                      onChange={(metrics) =>
                        form.setValue("northStar.metricIds", metrics)
                      }
                    />
                  </div>
                  <Field label="Title" {...form.register("northStar.title")} />
                </div>
              </div>
            </div>
          </div>
        </div>
        {hasFileConfig() && (
          <div className="alert alert-info my-3">
            The below settings are controlled through your{" "}
            <code>config.yml</code> file and cannot be changed through the web
            UI.{" "}
            <a
              href="https://docs.growthbook.io/self-host/config#organization-settings"
              target="_blank"
              rel="noreferrer"
              className="font-weight-bold"
            >
              View Documentation
            </a>
            .
          </div>
        )}
        {!hasFileConfig() && (
          <div className="alert alert-info my-3">
            <h3>Import/Export config.yml</h3>
            <p>
              {isCloud()
                ? "GrowthBook Cloud stores"
                : "You are currently storing"}{" "}
              all organization settings, data sources, metrics, and dimensions
              in a database.
            </p>
            <p>
              You can import/export these settings to a <code>config.yml</code>{" "}
              file to more easily move between GrowthBook Cloud accounts and/or
              self-hosted environments.{" "}
              <a
                href="https://docs.growthbook.io/self-host/config#configyml"
                target="_blank"
                rel="noreferrer"
                className="font-weight-bold"
              >
                Learn More
              </a>
            </p>
            <div className="row mb-3">
              <div className="col-auto">
                <BackupConfigYamlButton
                  settings={data?.organization?.settings}
                />
              </div>
              <div className="col-auto">
                <RestoreConfigYamlButton
                  settings={data?.organization?.settings}
                  mutate={mutate}
                />
              </div>
            </div>
            <div className="text-muted">
              <strong>Note:</strong> For security reasons, the exported file
              does not include data source connection secrets such as passwords.
              You must edit the file and add these yourself.
            </div>
          </div>
        )}
        <div className="bg-white p-3 border">
          <div className="row">
            <div className="col-sm-3">
              <h4>
                Visual Editor <span className="badge badge-warning">beta</span>
              </h4>
            </div>
            <div className="col-sm-9 pb-3">
              <p>
                The Visual Editor allows non-technical users to create and start
                experiments in production without writing any code.
              </p>
              <div>
                <div className="form-check">
                  <input
                    type="checkbox"
                    disabled={hasFileConfig()}
                    className="form-check-input "
                    {...form.register("visualEditorEnabled")}
                    id="checkbox-visualeditor"
                  />

                  <label
                    htmlFor="checkbox-visualeditor"
                    className="form-check-label"
                  >
                    Enable Visual Editor
                  </label>
                </div>
              </div>
              {value.visualEditorEnabled &&
                data.organization.settings?.visualEditorEnabled && (
                  <div className="bg-light p-3 my-3 border rounded">
                    <h5 className="font-weight-bold">Setup Instructions</h5>
                    <VisualEditorInstructions
                      apiKeys={data.apiKeys}
                      mutate={mutate}
                    />
                  </div>
                )}
            </div>
          </div>
          <div className="divider border-bottom mb-3 mt-3"></div>
          <div className="row">
            <div className="col-sm-3">
              <h4>Other Settings</h4>
            </div>
            <div className="col-sm-9 form-inline">
              <Field
                label="Minimum experiment length (in days) when importing past
                experiments"
                type="number"
                className="ml-2"
                containerClassName="mb-3"
                append="days"
                step="1"
                min="0"
                max="31"
                disabled={hasFileConfig()}
                {...form.register("pastExperimentsMinLength", {
                  valueAsNumber: true,
                })}
              />
              <Field
                label="Amount of historical data to include when analyzing metrics"
                append="days"
                className="ml-2"
                containerClassName="mb-3"
                disabled={hasFileConfig()}
                options={[7, 14, 30, 90, 180, 365]}
                {...form.register("metricAnalysisDays", {
                  valueAsNumber: true,
                })}
              />
              <Field
                label="Warn when this percent of experiment users are in multiple variations"
                type="number"
                step="any"
                min="0"
                max="1"
                className="ml-2"
                containerClassName="mb-3"
                disabled={hasFileConfig()}
                helpText={<span className="ml-2">from 0 to 1</span>}
                {...form.register("multipleExposureMinPercent", {
                  valueAsNumber: true,
                })}
              />
              <div className="mb-3">
                <Field
                  label="Experiment Auto-Update Frequency"
                  className="ml-2"
                  containerClassName="mb-2 mr-2"
                  disabled={hasFileConfig()}
                  options={[
                    {
                      display: "When results are X hours old",
                      value: "stale",
                    },
                    {
                      display: "Cron Schedule",
                      value: "cron",
                    },
                    {
                      display: "Never",
                      value: "never",
                    },
                  ]}
                  {...form.register("updateSchedule.type")}
                />
                {value.updateSchedule?.type === "stale" && (
                  <div className="bg-light p-3 border">
                    <Field
                      label="Refresh when"
                      append="hours old"
                      type="number"
                      step={1}
                      min={1}
                      max={168}
                      className="ml-2"
                      disabled={hasFileConfig()}
                      {...form.register("updateSchedule.hours", {
                        valueAsNumber: true,
                      })}
                    />
                  </div>
                )}
                {value.updateSchedule?.type === "cron" && (
                  <div className="bg-light p-3 border">
                    <Field
                      label="Cron String"
                      className="ml-2"
                      disabled={hasFileConfig()}
                      {...form.register("updateSchedule.cron")}
                      placeholder="0 */6 * * *"
                      onFocus={(e) => {
                        updateCronString(e.target.value);
                      }}
                      onBlur={(e) => {
                        updateCronString(e.target.value);
                      }}
                      helpText={<span className="ml-2">{cronString}</span>}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="divider border-bottom mb-3 mt-3"></div>

          <div className="row">
            <div className="col-12">
              <div className=" d-flex flex-row-reverse">
                <Button
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
        </div>
      </div>
    </div>
  );
};

export default GeneralSettingsPage;
