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
          <table className="table gbtable appbox">
            <thead>
              <tr>
                <th>Key</th>
                <th>Description</th>
                <th>Allowed Origins</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {webhookSecrets.map((secret) => (
                <tr key={secret.id}>
                  <td>
                    <ClickToCopy>{secret.key}</ClickToCopy>
                  </td>
                  <td>{secret.description}</td>
                  <td>
                    {secret.allowedOrigins?.length ? (
                      secret.allowedOrigins.join(", ")
                    ) : (
                      <em>Any</em>
                    )}
                  </td>
                  <td>{datetime(secret.dateCreated)}</td>
                  <td>{datetime(secret.dateUpdated)}</td>
                  <td>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
