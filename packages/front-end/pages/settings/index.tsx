import React, { useEffect, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { MemberRole, useAuth } from "../../services/auth";
import { FaCheck, FaPencilAlt } from "react-icons/fa";
import EditOrganizationForm from "../../components/Settings/EditOrganizationForm";
import { useForm } from "react-hook-form";
import { ApiKeyInterface } from "back-end/types/apikey";
import VisualEditorInstructions from "../../components/Settings/VisualEditorInstructions";
import track from "../../services/track";
import ConfigYamlButton from "../../components/Settings/ConfigYamlButton";
import { hasFileConfig, isCloud } from "../../services/env";
import { OrganizationSettings } from "back-end/types/organization";
import isEqual from "lodash/isEqual";

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

  // eslint-disable-next-line
  const form = useForm<OrganizationSettings>({
    defaultValues: {
      visualEditorEnabled: false,
      pastExperimentsMinLength: 6,
      // customization:
      customized: false,
      logoPath: "",
      primaryColor: "#391c6d",
      secondaryColor: "#50279a",
    },
  });
  const { apiCall, organizations, setOrganizations, orgId } = useAuth();

  useEffect(() => {
    if (data?.organization?.settings) {
      form.reset({
        ...data.organization.settings,
      });
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

  const value = {
    visualEditorEnabled: form.watch("visualEditorEnabled"),
    pastExperimentsMinLength: form.watch("pastExperimentsMinLength"),
    // customization:
    customized: form.watch("customized"),
    logoPath: form.watch("logoPath"),
    primaryColor: form.watch("primaryColor"),
    secondaryColor: form.watch("secondaryColor"),
  };
  const ctaEnabled = hasChanges(value, data?.organization?.settings);

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
  };

  return (
    <div className="container-fluid mt-3 pagecontents">
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
        {!hasFileConfig() && !isCloud() && (
          <div className="alert alert-info my-3">
            <h3>New Feature: config.yml support</h3>
            <p>
              You can now control the below settings as well as define data
              sources, metrics, and dimensions using a <code>config.yml</code>{" "}
              file. This file can be version controlled and easily moved between
              environments.{" "}
              <a
                href="https://docs.growthbook.io/self-host/config#configyml"
                target="_blank"
                rel="noreferrer"
                className="font-weight-bold"
              >
                Learn More
              </a>
              .
            </p>
            <p>
              Export existing settings:{" "}
              <ConfigYamlButton settings={data?.organization?.settings} />
            </p>
            <div className="text-muted">
              <strong>Note:</strong> Downloaded file does not include data
              source connection secrets such as passwords. You must edit the
              file and add these yourselves.
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
              <div className="form-group">
                Minimum experiment length (in days) when importing past
                experiments:
                <input
                  type="number"
                  className="form-control ml-2"
                  step="1"
                  min="0"
                  max="31"
                  disabled={hasFileConfig()}
                  {...form.register("pastExperimentsMinLength", {
                    valueAsNumber: true,
                  })}
                />
              </div>
            </div>
          </div>
          {!hasFileConfig() && (
            <>
              <div className="divider border-bottom mb-3 mt-3"></div>
              <div className="row">
                <div className="col-12">
                  <div className=" d-flex flex-row-reverse">
                    <button
                      className={`btn btn-${
                        ctaEnabled ? "primary" : "secondary"
                      }`}
                      type="submit"
                      disabled={!ctaEnabled}
                      onClick={async (e) => {
                        e.preventDefault();
                        if (!ctaEnabled) return;
                        saveSettings();
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GeneralSettingsPage;
