import React, { ReactElement, useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import {
  FaCheck,
  FaExclamationTriangle,
  FaInfoCircle,
  FaPaperPlane,
} from "react-icons/fa";
import { ago } from "shared/dates";
import { SDKConnectionInterface } from "@back-end/types/sdk-connection";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { GBAddCircle } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ClickToReveal from "@/components/Settings/ClickToReveal";

const payloadFormatLabels: Record<string, string | ReactElement> = {
  standard: "Standard",
  "standard-no-payload": (
    <>
      Standard
      <br />
      (no SDK Payload)
    </>
  ),
  sdkPayload: "SDK Payload only",
  none: "none",
};

export default function SdkWebhooks({
  connection,
}: {
  connection: SDKConnectionInterface;
}) {
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/sdk-connections/${connection.id}/webhooks`
  );
  const [
    createWebhookModalOpen,
    setCreateWebhookModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const canCreateWebhooks = permissionsUtil.canCreateSDKWebhook(connection);
  const canUpdateWebhook = permissionsUtil.canUpdateSDKWebhook(connection);
  const canDeleteWebhook = permissionsUtil.canDeleteSDKWebhook(connection);
  const hasWebhooks = !!data?.webhooks?.length;
  const disableWebhookCreate =
    !canCreateWebhooks ||
    (hasWebhooks && !hasCommercialFeature("multiple-sdk-webhooks"));

  const renderTableRows = () => {
    // only render table if there is data to show
    return data?.webhooks?.map((webhook) => (
      <tr key={webhook.name}>
        <td style={{ minWidth: 150 }}>{webhook.name}</td>
        <td
          style={{
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          <code className="text-main small">{webhook.endpoint}</code>
        </td>
        <td className="small">{webhook.httpMethod}</td>
        <td className="small">
          {payloadFormatLabels?.[webhook?.payloadFormat ?? "standard"]}
        </td>
        <td className="nowrap">
          {webhook.signingKey ? (
            <ClickToReveal
              valueWhenHidden="wk_abc123def456ghi789"
              getValue={async () => webhook.signingKey}
            />
          ) : (
            <em className="text-muted">hidden</em>
          )}
        </td>
        <td>
          {webhook.error ? (
            <>
              <span className="text-danger">
                <FaExclamationTriangle /> error
              </span>
              <Tooltip
                className="ml-1"
                innerClassName="pb-1"
                usePortal={true}
                body={
                  <>
                    <div className="alert alert-danger mt-2">
                      {webhook.error}
                    </div>
                  </>
                }
              />
            </>
          ) : webhook.lastSuccess ? (
            <em className="small">
              <FaCheck className="text-success" /> {ago(webhook.lastSuccess)}
            </em>
          ) : (
            <em>never fired</em>
          )}
        </td>
        <td>
          <Button
            color="outline-primary"
            className="btn-sm"
            style={{ width: 80 }}
            disabled={!canUpdateWebhook}
            onClick={async () => {
              await apiCall(`/sdk-webhooks/${webhook.id}/test`, {
                method: "post",
              });
              mutate();
            }}
          >
            <FaPaperPlane className="mr-1" />
            Test
          </Button>
        </td>
        <td className="px-0">
          <div className="col-auto mr-1">
            <MoreMenu>
              {canUpdateWebhook ? (
                <button
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setCreateWebhookModalOpen(webhook);
                  }}
                >
                  Edit
                </button>
              ) : null}
              {canDeleteWebhook ? (
                <DeleteButton
                  className="dropdown-item"
                  displayName="SDK Connection"
                  text="Delete"
                  useIcon={false}
                  onClick={async () => {
                    await apiCall(`/sdk-webhooks/${webhook.id}`, {
                      method: "DELETE",
                    });
                    mutate();
                  }}
                />
              ) : null}
            </MoreMenu>
          </div>
        </td>
      </tr>
    ));
  };
  const renderAddWebhookButton = () => (
    <>
      <div className="text-muted mb-3">
        Refer to the <DocLink docSection="sdkWebhooks">documentation</DocLink>{" "}
        for setup instructions
      </div>
      {canCreateWebhooks ? (
        <>
          <Tooltip
            body={
              disableWebhookCreate
                ? "You can only have one webhook per SDK Connection in the free plan"
                : ""
            }
          >
            <button
              className="btn btn-primary mb-2"
              disabled={disableWebhookCreate}
              onClick={(e) => {
                e.preventDefault();
                if (!disableWebhookCreate) setCreateWebhookModalOpen({});
              }}
            >
              <span className="h4 pr-2 m-0 d-inline-block align-top">
                <GBAddCircle />
              </span>
              Add Webhook
            </button>
          </Tooltip>
          <Tooltip
            body={
              <div style={{ lineHeight: 1.5 }}>
                <p className="mb-0">
                  <strong>SDK Webhooks</strong> will automatically notify any
                  changes affecting this SDK. For instance, modifying a feature
                  or AB test will prompt the webhook to fire.
                </p>
              </div>
            }
          >
            <span className="text-muted ml-2" style={{ fontSize: "0.75rem" }}>
              What is this? <FaInfoCircle />
            </span>
          </Tooltip>
        </>
      ) : null}
    </>
  );

  const renderTable = () => {
    return (
      <div className="gb-webhook-table-container mb-2">
        <table className="table appbox gbtable mb-0">
          <thead>
            <tr>
              <th>Webhook</th>
              <th>Endpoint</th>
              <th>Method</th>
              <th style={{ width: 130 }}>Format</th>
              <th>Shared Secret</th>
              <th style={{ width: 125 }}>Last Success</th>
              <th />
              <th className="px-0" style={{ width: 35 }} />
            </tr>
          </thead>
          <tbody>{renderTableRows()}</tbody>
        </table>
      </div>
    );
  };
  const isEmpty = data?.webhooks?.length === 0;
  return (
    <div className="gb-sdk-connections-webhooks mb-5">
      <h2 className="mb-2">SDK Webhooks</h2>
      {createWebhookModalOpen && (
        <WebhooksModal
          close={() => setCreateWebhookModalOpen(null)}
          onSave={mutate}
          current={createWebhookModalOpen}
          sdkConnectionId={connection.id}
        />
      )}
      {!isEmpty && renderTable()}
      {renderAddWebhookButton()}
    </div>
  );
}
