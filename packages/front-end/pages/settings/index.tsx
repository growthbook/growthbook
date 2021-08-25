import React, { useEffect, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { MemberRole, useAuth } from "../../services/auth";
import { FaCheck, FaPencilAlt } from "react-icons/fa";
import EditOrganizationForm from "../../components/Settings/EditOrganizationForm";
import useForm from "../../hooks/useForm";
import { ImplementationType } from "back-end/types/experiment";
import { ApiKeyInterface } from "back-end/types/apikey";
import VisualEditorInstructions from "../../components/Settings/VisualEditorInstructions";
import track from "../../services/track";
import ConfigYamlButton from "../../components/Settings/ConfigYamlButton";
import { hasFileConfig, isCloud } from "../../services/env";
import { useDefinitions } from "../../services/DefinitionsContext";
import { OrganizationSettings } from "back-end/types/organization";
import isEqual from "lodash/isEqual";

type OrgSettingsValue = OrganizationSettings & {
  types: { visual: boolean; code: boolean };
};

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

function hasChanges(value: OrgSettingsValue, existing: OrganizationSettings) {
  if (!existing) return true;

  const { types, ...newValues } = value;
  const newTypes = Object.keys(types).filter((k) => types[k]);
  const { implementationTypes, ...existingValues } = existing;
  const existingTypes = [...implementationTypes];

  newTypes.sort();
  existingTypes.sort();
  if (!isEqual(newTypes, existingTypes)) {
    console.log("types not equal", newTypes, existingTypes);
    return true;
  }

  if (!isEqual(newValues, existingValues)) {
    console.log("other props not equal", newValues, existingValues);
    return true;
  }

  return false;
}

const GeneralSettingsPage = (): React.ReactElement => {
  const { data, error, mutate } = useApi<SettingsApiResponse>(`/organization`);
  const [editOpen, setEditOpen] = useState(false);

  // eslint-disable-next-line
  const [value, inputProps, manualUpdate] = useForm<OrgSettingsValue>({
    types: {
      visual: false,
      code: false,
    },
    pastExperimentsMinLength: 6,
    // customization:
    customized: false,
    logoPath: "",
    primaryColor: "#391c6d",
    secondaryColor: "#50279a",
  });
  const { apiCall, organizations, setOrganizations, orgId } = useAuth();

  const { dimensions, metrics, datasources } = useDefinitions();
  const hasDefinitions =
    dimensions.length > 0 || metrics.length > 0 || datasources.length > 0;

  useEffect(() => {
    if (data?.organization?.settings) {
      const { implementationTypes, ...freshValues } =
        data.organization.settings || {};
      let types = value.types;
      if (implementationTypes) {
        types = {
          visual: implementationTypes.includes("visual"),
          code: implementationTypes.includes("code"),
        };
      }

      manualUpdate({
        ...value,
        ...freshValues,
        types,
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

  const ctaEnabled = hasChanges(value, data?.organization?.settings);

  const saveSettings = async () => {
    const { types, ...otherSettings } = value;

    const implementationTypes: ImplementationType[] = types.visual
      ? ["code", "visual"]
      : ["code"];

    const newSettings: OrganizationSettings = {
      ...otherSettings,
      implementationTypes,
    };

    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: newSettings,
      }),
    });
    await mutate();
    organizations.forEach((org) => {
      if (org.id === orgId) {
        org.settings = newSettings;
      }
    });
    setOrganizations(organizations);

    // Track usage of the Visual Editor
    if (
      value.types.visual &&
      !(data?.organization?.settings?.implementationTypes || []).includes(
        "visual"
      )
    ) {
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
      <div className=" mb-1">
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
          <div className="divider border-bottom mb-3 mt-2"></div>
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
                    className="form-check-input "
                    checked={value.types.visual}
                    onChange={(e) => {
                      manualUpdate({
                        types: {
                          code: true,
                          visual: e.target.checked,
                        },
                      });
                    }}
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
              {value.types.visual &&
                data.organization.settings?.implementationTypes?.includes(
                  "visual"
                ) && (
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
          {/*}
          <div className="divider border-bottom mb-3 mt-2"></div>
          <div className="row">
            <div className="col-sm-3">
              <h4>
                Custom Branding{" "}
                <span className="badge badge-warning">beta</span>
              </h4>
            </div>
            <div className="col-sm-9">
              <div className="form-group row">
                <div className="col-auto ">
                  <div className="form-check">
                    <input
                      type="checkbox"
                      className="form-check-input "
                      checked={value.customized}
                      onChange={(e) => {
                        manualUpdate({
                          customized: e.target.checked,
                        });
                      }}
                      id="checkbox-customized"
                    />

                    <label
                      htmlFor="checkbox-customized"
                      className="form-check-label"
                    >
                      Enable custom branding
                    </label>
                  </div>
                </div>
                <div className="col-sm-9"></div>
              </div>
              {value.customized && (
                <>
                  <div className="form-group row">
                    <div className="col-sm-3 col-form-label">
                      <label htmlFor="customlogo">Custom logo</label>
                    </div>
                    <div className="col-sm-9">
                      <input
                        type="text"
                        className="form-control"
                        id="customlogo"
                        placeholder="/path/to/logo.png"
                        {...inputProps.logoPath}
                      />
                      <p>
                        <small className="text-muted">
                          Logo will be scaled to fit 225 x 46
                        </small>
                      </p>
                    </div>
                  </div>
                  <div className="form-group row">
                    <div className="col-sm-3 col-form-label">
                      <label htmlFor="formGroupExampleInput">
                        Primary Color
                      </label>
                    </div>
                    <div className="col-sm-9">
                      <input
                        className="form-control"
                        type="color"
                        id="primarycolor"
                        name="primarycolor"
                        {...inputProps.primaryColor}
                      />
                    </div>
                  </div>
                  <div className="form-group row">
                    <div className="col-sm-3 col-form-label">
                      <label htmlFor="formGroupExampleInput">
                        Secondary Color
                      </label>
                    </div>
                    <div className="col-sm-9">
                      <input
                        className="form-control"
                        type="color"
                        id="secondarycolor"
                        name="secondarycolor"
                        {...inputProps.secondaryColor}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
              */}
          {hasDefinitions && !hasFileConfig() && !isCloud() && (
            <>
              <div className="divider border-bottom mb-3 mt-2"></div>
              <div className="row">
                <div className="col-sm-3">
                  <h4>
                    Export Config{" "}
                    <span className="badge badge-warning">beta</span>
                  </h4>
                </div>
                <div className="col-sm-9">
                  <p>
                    You can now define data sources, metrics, and dimensions
                    using a <code>config.yml</code> file. This allows you to
                    version control your definitions and easily move them
                    between environments.{" "}
                    <a
                      href="https://docs.growthbook.io/self-host/config#configyml"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Learn More
                    </a>
                    .
                  </p>
                  <p>
                    You can export your existing definitions here:{" "}
                    <ConfigYamlButton />
                  </p>
                  <p className="text-muted">
                    <strong>Note:</strong> Downloaded file does not include data
                    source connection secrets such as passwords. You must edit
                    the file and add these yourselves.
                  </p>
                </div>
              </div>
            </>
          )}
          <div className="divider border-bottom mb-3 mt-3"></div>
          <div className="row">
            <div className="col-sm-3">
              <h4>Other Settings</h4>
            </div>
            <div className="col-sm-9 form-inline">
              {hasFileConfig() && (
                <div className="alert alert-info">
                  The below settings are controlled through your{" "}
                  <code>config.yml</code> file and cannot be changed through the
                  web UI.{" "}
                  <a href="https://docs.growthbook.io/self-host/config#configyml">
                    View Documentation
                  </a>
                </div>
              )}
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
                  {...inputProps.pastExperimentsMinLength}
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
