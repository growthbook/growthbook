import React, { useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import { FaCheck, FaInfoCircle } from "react-icons/fa";
import { ago } from "shared/dates";
import { BsArrowRepeat } from "react-icons/bs";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import Tooltip from "@/components/Tooltip/Tooltip";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { GBAddCircle } from "@/components/Icons";

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
    // only render table if there is data to show
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
        {hasWebhookPermitions && (
          <td>
            <Button
              color="link"
              className="btn-sm"
              onClick={async () => {
                await apiCall(`/webhook/test/${webhook.id}`, {
                  method: "get",
                });
                mutate();
              }}
            >
              <BsArrowRepeat /> Test Webhook
            </Button>
          </td>
        )}
        <td>
          {hasWebhookPermitions && (
            <>
              <div className="col-auto">
                <MoreMenu>
                  <button
                    className="dropdown-item"
                    onClick={(e) => {
                      e.preventDefault();
                      if (!disableWebhookCreate)
                        setCreateWebhookModalOpen(webhook);
                    }}
                  >
                    Edit
                  </button>
                  <DeleteButton
                    className="dropdown-item"
                    displayName="SDK Connection"
                    text="Delete"
                    useIcon={false}
                    onClick={async () => {
                      await apiCall(`/webhook/${webhook.id}`, {
                        method: "DELETE",
                      });
                      mutate();
                    }}
                  />
                </MoreMenu>
              </div>
            </>
          )}
        </td>
      </tr>
    ));
  };
  const renderAddWebhookButton = () => (
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
          <span className="h4 pr-2 m-0 d-inline-block align-top">
            <GBAddCircle />
          </span>
          Add Webhook
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
      <div className="gb-webhook-table-container">
        <table className="table appbox gbtable mb-1">
          <thead>
            <tr>
              <td>WEBHOOK</td>
              <td>ENDPOINT</td>
              <td>SEND PAYLOAD</td>
              <td>SHARED SECRET</td>
              <td>LAST SUCCESS</td>
              {hasWebhookPermitions && <td>TEST WEBHOOK</td>}
              <td>EDIT</td>
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
      {!isEmpty && renderTable()}
      {renderAddWebhookButton()}
    </div>
  );
}
