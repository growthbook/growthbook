import React, { FC, useState } from "react";
import { datetime } from "shared/dates";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { EventWebHookListContainer } from "@/components/EventWebHooks/EventWebHookList/EventWebHookList";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/ui/Button";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import WebhookSecretModal from "@/components/EventWebHooks/WebhookSecretModal";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
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
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="pagecontents">
        <EventWebHookListContainer />

        <div className="mt-5">
          <h2>Webhook Secrets</h2>
          <p>
            Define secret variables that can be used within your webhook
            endpoints or headers. Simply reference them using Handlebars syntax.
            For example, <code>{"{{ MY_SECRET }}"}</code>.
          </p>
          <Table className="gbtable appbox">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Key</TableColumnHeader>
                <TableColumnHeader>Description</TableColumnHeader>
                <TableColumnHeader>Allowed Origins</TableColumnHeader>
                <TableColumnHeader>Created</TableColumnHeader>
                <TableColumnHeader>Updated</TableColumnHeader>
                <TableColumnHeader></TableColumnHeader>
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
                  <TableCell>
                    <MoreMenu>
                      <a
                        href="#"
                        className="dropdown-item"
                        onClick={(e) => {
                          e.preventDefault();
                          setEditSecretId(secret.id);
                        }}
                      >
                        Edit
                      </a>
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
        </div>
      </div>
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
    </div>
  );
};
export default WebhooksPage;
