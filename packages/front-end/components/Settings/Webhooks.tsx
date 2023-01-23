import React, { FC, Fragment, useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import { FaCheck, FaBolt, FaPencilAlt } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { ago } from "@/services/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "../DeleteButton/DeleteButton";
import LoadingOverlay from "../LoadingOverlay";
import Tooltip from "../Tooltip/Tooltip";
import { DocLink } from "../DocLink";
import WebhooksModal from "./WebhooksModal";

const Webhooks: FC = () => {
  const { data, error, mutate } = useApi<{ webhooks: WebhookInterface[] }>(
    "/webhooks"
  );
  const { getProjectById, projects } = useDefinitions();
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<null | Partial<WebhookInterface>>(null);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {open && (
        <WebhooksModal
          close={() => setOpen(null)}
          onSave={mutate}
          current={open}
        />
      )}

      <p>
        SDK Endpoint Webhooks push the latest feature definitions to your server
        whenever they are modified within the GrowthBook app.{" "}
        <DocLink docSection="webhooks">View Documentation</DocLink>
      </p>

      {data.webhooks.length > 0 && (
        <table className="table mb-3 appbox gbtable">
          <thead>
            <tr>
              <th>Webhook</th>
              <th>Endpoint</th>
              <th>Environment</th>
              {projects.length > 0 && <th>Project</th>}
              <th>Shared Secret</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.webhooks.map((webhook) => (
              <Fragment key={webhook.id}>
                <tr>
                  <td>
                    {webhook.name}
                    {!webhook.featuresOnly && (
                      <Tooltip body="In addition to features, legacy webhooks also include experiment overrides which are now deprecated">
                        <span className="badge badge-warning ml-2">legacy</span>
                      </Tooltip>
                    )}
                  </td>
                  <td className="text-break">{webhook.endpoint}</td>
                  <td>
                    {!webhook.environment ? (
                      <>
                        <span className="badge badge-secondary mr-1">dev</span>
                        <span className="badge badge-secondary">
                          production
                        </span>
                      </>
                    ) : (
                      <span className="badge badge-secondary">
                        {webhook.environment}
                      </span>
                    )}
                  </td>
                  {projects.length > 0 && (
                    <td>
                      {webhook.project ? (
                        getProjectById(webhook.project)?.name || webhook.project
                      ) : (
                        <em className="text-muted">All Projects</em>
                      )}
                    </td>
                  )}
                  <td>
                    <code>{webhook.signingKey}</code>
                  </td>
                  <td>
                    {webhook.error ? (
                      <pre className="text-danger">Error</pre>
                    ) : webhook.lastSuccess ? (
                      <em>
                        <FaCheck className="text-success" /> last fired{" "}
                        {ago(webhook.lastSuccess)}
                      </em>
                    ) : (
                      <em>never fired</em>
                    )}
                  </td>
                  <td>
                    <a
                      href="#"
                      className="tr-hover text-primary mr-3"
                      title="Edit this webhook"
                      onClick={(e) => {
                        e.preventDefault();
                        setOpen(webhook);
                      }}
                    >
                      <FaPencilAlt />
                    </a>
                    <DeleteButton
                      link={true}
                      className={"tr-hover text-primary"}
                      displayName="Webhook"
                      title="Delete this webhook"
                      onClick={async () => {
                        await apiCall(`/webhook/${webhook.id}`, {
                          method: "DELETE",
                        });
                        mutate();
                      }}
                    />
                  </td>
                </tr>
                {webhook.error && (
                  <tr>
                    <td colSpan={6} className="border-0">
                      <pre className="text-danger mb-0 pb-0">
                        {webhook.error}
                      </pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setOpen({});
        }}
      >
        <FaBolt /> Create New SDK Webhook
      </button>
    </div>
  );
};

export default Webhooks;
