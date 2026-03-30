import React, { FC, Fragment } from "react";
import { WebhookInterface } from "shared/types/webhook";
import { FaCheck } from "react-icons/fa";
import { Box } from "@radix-ui/themes";
import { ago } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import LoadingOverlay from "@/components/LoadingOverlay";
import Tooltip from "@/components/Tooltip/Tooltip";
import OverflowText from "@/components/Experiment/TabbedPage/OverflowText";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
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

  const colCount = 6 + (projects.length > 0 ? 1 : 0);

  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <Box>
      <Box mb="3">
        <p style={{ margin: 0 }}>
          SDK Endpoint Webhooks push the latest feature definitions to your
          server whenever they are modified within the GrowthBook app.
        </p>
      </Box>

      {data.webhooks.length > 0 && (
        <Table variant="list" stickyHeader roundedCorners className="mb-3">
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Webhook</TableColumnHeader>
              <TableColumnHeader>Endpoint</TableColumnHeader>
              <TableColumnHeader>Environment</TableColumnHeader>
              {projects.length > 0 ? (
                <TableColumnHeader>Project</TableColumnHeader>
              ) : null}
              <TableColumnHeader>Shared Secret</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader style={{ width: 40 }} />
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
                        <Badge
                          label="legacy"
                          color="amber"
                          variant="soft"
                          ml="2"
                        />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell
                    style={{ wordBreak: "break-word", maxWidth: 280 }}
                    className="text-break"
                  >
                    {webhook.endpoint}
                  </TableCell>
                  <TableCell>
                    {!webhook.environment ? (
                      <>
                        <Badge label="dev" color="gray" variant="soft" mr="1" />
                        <Badge label="production" color="gray" variant="soft" />
                      </>
                    ) : (
                      <Badge
                        label={webhook.environment}
                        color="gray"
                        variant="soft"
                      />
                    )}
                  </TableCell>
                  {projects.length > 0 ? (
                    <TableCell>
                      {webhook.project ? (
                        getProjectById(webhook.project)?.name || webhook.project
                      ) : (
                        <em style={{ color: "var(--gray-11)" }}>
                          All Projects
                        </em>
                      )}
                    </TableCell>
                  ) : null}
                  <TableCell>
                    <code>{webhook.signingKey}</code>
                  </TableCell>
                  <TableCell>
                    {webhook.error ? (
                      <pre
                        className="text-danger mb-0"
                        style={{ margin: 0, fontSize: "inherit" }}
                      >
                        Error
                      </pre>
                    ) : webhook.lastSuccess ? (
                      <em>
                        <FaCheck className="text-success" /> last fired{" "}
                        {ago(webhook.lastSuccess)}
                      </em>
                    ) : (
                      <em>never fired</em>
                    )}
                  </TableCell>
                  <TableCell
                    style={{ cursor: "initial" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {permissionsUtil.canManageLegacySDKWebhooks() ? (
                      <DeleteButton
                        link={true}
                        className="text-primary"
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
                {webhook.error ? (
                  <TableRow>
                    <TableCell
                      colSpan={colCount}
                      style={{ borderTop: "none", boxShadow: "none" }}
                    >
                      <OverflowText
                        className="text-danger mb-0 pb-0"
                        maxWidth={400}
                        title={webhook.error}
                      >
                        {webhook.error}
                      </OverflowText>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};

export default Webhooks;
