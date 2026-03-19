import React, { FC, useState } from "react";
import { datetime } from "shared/dates";
import { Box } from "@radix-ui/themes";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "@/components/EventWebHooks/EventWebHookList/EventWebHookList";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import Table, {
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

const WebhooksPage: FC = () => {
  const permissionsUtil = usePermissionsUtil();

  const canManageWebhooks =
    permissionsUtil.canCreateEventWebhook() ||
    permissionsUtil.canUpdateEventWebhook() ||
    permissionsUtil.canDeleteEventWebhook();

  const { apiCall } = useAuth();

  const { webhookSecrets, mutateDefinitions } = useDefinitions();

  const [editSecretId, setEditSecretId] = useState<string | null>(null);

  const queryParams = new URLSearchParams(window.location.search);
  const [newSecretOpen, setNewSecretOpen] = useState<boolean>(
    queryParams.has("newSecret") || false,
  );

  if (!canManageWebhooks) {
    return (
      <Box className="container pagecontents">
        <Callout status="error">
          You do not have access to view this page.
        </Callout>
      </Box>
    );
  }

  return (
    <Box className="container-fluid pagecontents">
      <Box className="pagecontents">
        <EventWebHookListContainer />

        <Box mt="5">
          <Heading as="h2">Webhook Secrets</Heading>
          <Box mb="3">
            <p style={{ margin: 0 }}>
              Define secret variables that can be used within your webhook
              endpoints or headers. Simply reference them using Handlebars
              syntax. For example, <code>{"{{ MY_SECRET }}"}</code>.
            </p>
          </Box>
          <Table variant="list" stickyHeader roundedCorners className="mb-3">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Key</TableColumnHeader>
                <TableColumnHeader>Description</TableColumnHeader>
                <TableColumnHeader>Allowed Origins</TableColumnHeader>
                <TableColumnHeader>Created</TableColumnHeader>
                <TableColumnHeader>Updated</TableColumnHeader>
                <TableColumnHeader style={{ width: 40 }} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhookSecrets.map((secret) => (
                <TableRow key={secret.id}>
                  <TableCell>
                    <ClickToCopy>{secret.key}</ClickToCopy>
                  </TableCell>
                  <TableCell>{secret.description}</TableCell>
                  <TableCell>
                    {secret.allowedOrigins?.length ? (
                      secret.allowedOrigins.join(", ")
                    ) : (
                      <em>Any</em>
                    )}
                  </TableCell>
                  <TableCell>{datetime(secret.dateCreated)}</TableCell>
                  <TableCell>{datetime(secret.dateUpdated)}</TableCell>
                  <TableCell
                    style={{ cursor: "initial" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreMenu>
                      <button
                        type="button"
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditSecretId(secret.id);
                        }}
                      >
                        Edit
                      </button>
                      <DeleteButton
                        onClick={async () => {
                          await apiCall<void>(`/webhook-secrets/${secret.id}`, {
                            method: "DELETE",
                          });
                          await mutateDefinitions();
                        }}
                        className="dropdown-item"
                        displayName="Webhook Secret"
                        text="Delete Secret"
                      />
                    </MoreMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button variant="solid" onClick={() => setNewSecretOpen(true)}>
            Add Webhook Secret
          </Button>
        </Box>
      </Box>
      {newSecretOpen && (
        <WebhookSecretModal
          close={() => {
            setNewSecretOpen(false);
          }}
        />
      )}
      {editSecretId && (
        <WebhookSecretModal
          existingId={editSecretId}
          close={() => {
            setEditSecretId(null);
          }}
        />
      )}
    </Box>
  );
};
export default WebhooksPage;
