import React, { FC, Fragment } from "react";
import { WebhookInterface } from "shared/types/webhook";
import { FaCheck } from "react-icons/fa";
import { ago } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import LoadingOverlay from "@/components/LoadingOverlay";
import Tooltip from "@/components/Tooltip/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

const Webhooks: FC = () => {
  const { data, error, mutate } = useApi<{ webhooks: WebhookInterface[] }>(
    "/legacy-sdk-webhooks",
  );
  const { getProjectById, projects } = useDefinitions();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      <p>
        SDK Endpoint Webhooks push the latest feature definitions to your server
        whenever they are modified within the GrowthBook app.
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
                    {permissionsUtil.canManageLegacySDKWebhooks() ? (
                      <DeleteButton
                        link={true}
                        className={"text-primary"}
                        displayName="Webhook"
                        title="Delete this webhook"
                        onClick={async () => {
                          await apiCall(`/legacy-sdk-webhooks/${webhook.id}`, {
                            method: "DELETE",
                          });
                          mutate();
                        }}
                      />
                    ) : null}
                  </td>
                </tr>
                {webhook.error && (
                  <tr>
                    <td colSpan={6} className="border-0">
                      <OverflowText
                        className="text-danger mb-0 pb-0"
                        maxWidth={400}
                        title={webhook.error}
                      >
                        {webhook.error}
                      </OverflowText>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Webhooks;
