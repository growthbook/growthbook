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
import { useUser } from "@/services/UserContext";
import Button from "@/components/Button";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { GBAddCircle } from "@/components/Icons";
import { DocLink } from "@/components/DocLink";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export default function SdkWebhooks({ sdkid }) {
  const { data, mutate } = useApi<{ webhooks?: WebhookInterface[] }>(
    `/webhooks/sdk/${sdkid}`
  );
  const [
    createWebhookModalOpen,
    setCreateWebhookModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const canCreateWebhooks = permissionsUtil.canCreateSDKWebhook();
  const canUpdateWebhook = permissionsUtil.canUpdateSDKWebhook();
  const canDeleteWebhook = permissionsUtil.canDeleteSDKWebhook();
  const hasWebhooks = !!data?.webhooks?.length;
  const disableWebhookCreate =
    !canCreateWebhooks ||
    (hasWebhooks && !hasCommercialFeature("multiple-sdk-webhooks"));

  const renderTableRows = () => {
    // only render table if there is data to show
    return data?.webhooks?.map((webhook) => (
      <tr key={webhook.name}>
        <td>{webhook.name}</td>
        <td>{webhook.endpoint}</td>
        <td>{webhook.sendPayload ? "yes" : "no"}</td>
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
          <Button
            color="link"
            className="btn-sm"
            disabled={!canUpdateWebhook}
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
        <td>
          <div className="col-auto">
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
                    await apiCall(`/webhook/${webhook.id}`, {
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
              <td>WEBHOOK</td>
              <td>ENDPOINT</td>
              <td>SEND PAYLOAD</td>
              <td>SHARED SECRET</td>
              <td>LAST SUCCESS</td>
              <td>TEST WEBHOOK</td>
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
      <h2 className="mb-2">SDK Webhooks</h2>
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
