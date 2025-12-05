import React, { FC, Fragment } from "react";
import { WebhookInterface } from "back-end/types/webhook";
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
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

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
        <Table variant="standard" className="mb-3 appbox">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Webhook</TableColumnHeader>
              <TableColumnHeader>Endpoint</TableColumnHeader>
              <TableColumnHeader>Environment</TableColumnHeader>
              {projects.length > 0 && <TableColumnHeader>Project</TableColumnHeader>}
              <TableColumnHeader>Shared Secret</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader></TableColumnHeader>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.webhooks.map((webhook) => (
              <Fragment key={webhook.id}>
                <TableRow>
                  <TableCell>
                    {webhook.name}
                    {!webhook.featuresOnly && (
                      <Tooltip body="In addition to features, legacy webhooks also include experiment overrides which are now deprecated">
                        <span className="badge badge-warning ml-2">legacy</span>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell className="text-break">{webhook.endpoint}</TableCell>
                  <TableCell>
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
                  </TableCell>
                  {projects.length > 0 && (
                    <TableCell>
                      {webhook.project ? (
                        getProjectById(webhook.project)?.name || webhook.project
                      ) : (
                        <em className="text-muted">All Projects</em>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <code>{webhook.signingKey}</code>
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                  <TableCell>
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
                  </TableCell>
                </TableRow>
                {webhook.error && (
                  <TableRow>
                    <TableCell colSpan={6} className="border-0">
                      <OverflowText
                        className="text-danger mb-0 pb-0"
                        maxWidth={400}
                        title={webhook.error}
                      >
                        {webhook.error}
                      </OverflowText>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};

export default Webhooks;
