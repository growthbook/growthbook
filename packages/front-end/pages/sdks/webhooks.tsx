import React, { useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import {
  FaCheck,
  FaInfoCircle,
  FaPencilAlt,
  FaPlusCircle,
} from "react-icons/fa";
import { ago } from "shared/dates";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";

export default function SDKWebhooks({ sdkid }) {
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/webhooks/sdk/${sdkid}`
  );
  const [
    createWebhookModalOpen,
    setCreateWebhookModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();
  const permissions = usePermissions();
  const { accountPlan } = useUser();

  const hasWebhookPermitions = permissions.check("manageWebhooks");
  const amountOfWebhooks = data?.webhooks?.length || 0;
  const webhookLimits = {
    pro: 99,
    starter: 2,
  };
  const disableWebhookCreate =
    (accountPlan?.includes("pro") && amountOfWebhooks < webhookLimits.pro) ||
    accountPlan?.includes("starter") ||
    (accountPlan?.includes("unknown") &&
      amountOfWebhooks < webhookLimits.starter);
  const renderTableRows = () => {
    // only rener table is there is data to show
    return data?.webhooks?.map((webhook) => (
      <tr key={webhook.name}>
        <td>{webhook.name}</td>
        <td>{webhook.endpoint}</td>
        <td>{webhook.sendPayload === true ? "yes" : "no"}</td>
        <td>{webhook.signingKey}</td>
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
              if (!disableWebhookCreate) setCreateWebhookModalOpen(webhook);
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
    ));
  };
  const renderEmptyState = () => (
    <>
      {hasWebhookPermitions && (
        <button
          className="btn btn-primary mb-2"
          disabled={disableWebhookCreate}
          onClick={(e) => {
            e.preventDefault();
            if (!disableWebhookCreate) setCreateWebhookModalOpen({});
          }}
        >
          Add webhook
        </button>
      )}
      <Tooltip
        body={
          <div style={{ lineHeight: 1.5 }}>
            <p className="mb-0">
              <strong>SDK Webhooks</strong> will automatically notify any
              changes affecting this SDK. For instance, modifying a feature or
              AB test will prompt the webhook to fire.
            </p>
          </div>
        }
      >
        <span className="text-muted ml-2" style={{ fontSize: "0.75rem" }}>
          What is this? <FaInfoCircle />
        </span>
      </Tooltip>
    </>
  );

  const renderTable = () => {
    return (
      <table className="table appbox gbtable mb-1">
        <thead>
          <tr>
            <td>WEBHOOK</td>
            <td>ENDPOINT</td>
            <td>SEND PAYLOAD</td>
            <td>SHARED SECRET</td>
            <td>LAST SUCCESS</td>
            <td>EDIT</td>
          </tr>
        </thead>
        <tbody>{renderTableRows()}</tbody>
      </table>
    );
  };
  const renderWebhooks = () => (
    <>
      {renderTable()}
      {hasWebhookPermitions && (
        <button
          className="btn btn-link mb-3 "
          type="button"
          disabled={disableWebhookCreate}
          onClick={(e) => {
            e.preventDefault();
            setCreateWebhookModalOpen({});
          }}
        >
          <FaPlusCircle className="mr-1" />
          Add Webhook
        </button>
      )}
    </>
  );

  const isEmpty = data?.webhooks?.length === 0;
  return (
    <div className="gb-sdk-connections-webhooks mb-5">
      <h2>SDK Webhooks</h2>
      {createWebhookModalOpen && (
        <WebhooksModal
          close={() => setCreateWebhookModalOpen(null)}
          onSave={mutate}
          current={createWebhookModalOpen}
          showSDKMode={true}
          sdkid={sdkid}
        />
      )}
      {isEmpty ? renderEmptyState() : renderWebhooks()}
    </div>
  );
}
