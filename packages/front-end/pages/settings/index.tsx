import React, { useEffect, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../../components/LoadingOverlay";
import { MemberRole, OrganizationSettings, useAuth } from "../../services/auth";
import {
  FaAngleRight,
  FaCheck,
  FaCreditCard,
  FaDatabase,
  FaKey,
  FaPencilAlt,
  FaUsers,
} from "react-icons/fa";
import Link from "next/link";
import EditOrganizationForm from "../../components/Settings/EditOrganizationForm";
import useForm from "../../hooks/useForm";
import { ImplementationType } from "back-end/types/experiment";
import Modal from "../../components/Modal";

export type SettingsApiResponse = {
  status: number;
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

const links = [
  {
    icon: <FaUsers />,
    display: "Team",
    url: "/settings/team",
  },
  {
    icon: <FaCreditCard />,
    display: "Billing",
    url: "/settings/billing",
  },
  {
    icon: <FaKey />,
    display: "API Keys",
    url: "/settings/keys",
  },
  {
    icon: <FaDatabase />,
    display: "Data Sources",
    url: "/settings/datasources",
  },
];

function hasTypeChanges(
  value: {
    visual: boolean;
    code: boolean;
    configuration: boolean;
    custom: boolean;
  },
  types: ImplementationType[]
) {
  const current = Object.keys(value).filter((k) => value[k]);
  if (current.length !== types.length) return true;

  const existing = [...types];
  existing.sort();
  current.sort();

  return JSON.stringify(existing) !== JSON.stringify(current);
}

const SettingsPage = (): React.ReactElement => {
  const { data, error, mutate } = useApi<SettingsApiResponse>(`/organization`);

  const [editOpen, setEditOpen] = useState(false);

  // eslint-disable-next-line
  const [value, _, manualUpdate] = useForm({
    visual: false,
    code: false,
    configuration: false,
    custom: false,
  });

  const { apiCall, organizations, setOrganizations, orgId } = useAuth();

  useEffect(() => {
    if (!data?.organization?.settings?.implementationTypes) return;
    const types = data.organization.settings.implementationTypes;
    manualUpdate({
      visual: types.includes("visual"),
      code: types.includes("code"),
      configuration: types.includes("configuration"),
      custom: types.includes("custom"),
    });
  }, [data?.organization?.settings?.implementationTypes]);

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

  const typeChanges = hasTypeChanges(
    value,
    data?.organization?.settings?.implementationTypes || []
  );

  return (
    <div className="container-fluid mt-3 pagecontents">
      {editOpen && (
        <EditOrganizationForm
          name={data.organization.name}
          close={() => setEditOpen(false)}
          mutate={mutate}
        />
      )}
      <h1>Settings</h1>

      <div className="row mb-1">
        <div className="col-auto">
          <strong>Organization Name:</strong> {data.organization.name}{" "}
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
        <div className="col-auto">
          <strong>Owner:</strong> {data.organization.ownerEmail}
        </div>
        {data.organization.slackTeam && (
          <div
            className="col-auto"
            title={"Team: " + data.organization.slackTeam}
          >
            <FaCheck /> Connected to Slack
          </div>
        )}
      </div>
      <div className="row mb-3">
        <div className="col-auto">
          <Modal
            header="Experiment Implementation"
            open={true}
            inline={true}
            autoCloseOnSubmit={false}
            ctaEnabled={typeChanges}
            submit={async () => {
              if (!typeChanges) {
                return;
              }
              const types = (Object.keys(value) as ImplementationType[]).filter(
                (k) => value[k]
              );
              await apiCall(`/organization`, {
                method: "PUT",
                body: JSON.stringify({
                  settings: {
                    implementationTypes: types,
                  },
                }),
              });
              await mutate();
              organizations.forEach((org) => {
                if (org.id === orgId) {
                  org.settings = org.settings || {};
                  org.settings.implementationTypes = types;
                }
              });
              setOrganizations(organizations);
            }}
            cta="Save"
          >
            <p>Control which implementation methods are enabled.</p>
            <div className="form-check mb-3">
              <input
                type="checkbox"
                className="form-check-input"
                checked={value.visual}
                onChange={(e) => {
                  manualUpdate({
                    visual: e.target.checked,
                  });
                }}
                id="checkbox-visual"
              />
              <label className="form-check-label" htmlFor="checkbox-visual">
                Visual Designer
              </label>
              <small className="form-text text-muted">
                <strong>Requires our Browser SDK.</strong> Change html/css
                without writing code.
              </small>
            </div>
            <div className="form-check mb-3">
              <input
                type="checkbox"
                className="form-check-input"
                checked={value.code}
                onChange={(e) => {
                  manualUpdate({
                    code: e.target.checked,
                  });
                }}
                id="checkbox-code"
              />
              <label className="form-check-label" htmlFor="checkbox-code">
                Code
              </label>
              <small className="form-text text-muted">
                <strong>Requires our Browser, NodeJS, PHP, or Ruby SDK</strong>
              </small>
            </div>
            <div className="form-check mb-3">
              <input
                type="checkbox"
                className="form-check-input"
                checked={value.configuration}
                onChange={(e) => {
                  manualUpdate({
                    configuration: e.target.checked,
                  });
                }}
                id="checkbox-configuration"
              />
              <label
                className="form-check-label"
                htmlFor="checkbox-configuration"
              >
                Feature Flags
              </label>
              <small className="form-text text-muted">
                <strong>Requires our Browser, NodeJS, PHP, or Ruby SDK</strong>
              </small>
            </div>
            <div className="form-check">
              <input
                type="checkbox"
                className="form-check-input"
                checked={value.custom}
                onChange={(e) => {
                  manualUpdate({
                    custom: e.target.checked,
                  });
                }}
                id="checkbox-custom"
              />
              <label className="form-check-label" htmlFor="checkbox-custom">
                Custom
              </label>
              <small className="form-text text-muted">
                No requirements. Leaves implementation entirely up to you.
              </small>
            </div>
          </Modal>
        </div>
        <div className="col-auto pt-4">
          <h3>Additional Settings</h3>
          <div className="list-group">
            {links.map((l, i) => (
              <Link key={i} href={l.url}>
                <a className="list-group-item list-group-item-action">
                  <div className="row">
                    <div className="col-auto">{l.icon}</div>
                    <div className="col-auto">{l.display}</div>
                    <div style={{ flex: 1 }} />
                    <div className="col-auto">
                      <FaAngleRight />
                    </div>
                  </div>
                </a>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
