import React, { useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import { FaPencilAlt } from "react-icons/fa";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";

export default function SDKWebhooks({ sdkid }) {
  const { data, mutate } = useApi(`/webhooks/sdk/${sdkid}`);
  const [
    createModalOpen,
    setCreateModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const { apiCall } = useAuth();

  const renderTableRows = () => {
    const webhooks = data?.webhooks as WebhookInterface[];
    return webhooks?.map((webhook) => (
      <tr key={webhook.name}>
        <td>{webhook.name}</td>
        <td>{webhook.endpoint}</td>
        <td>{webhook.sendPayload === true ? "yes" : "no"}</td>
        <td>{webhook.signingKey}</td>
        <td>{webhook.sdks}</td>
        <td>
          <a
            href="#"
            className="tr-hover text-primary mr-3"
            title="Edit this webhook"
            onClick={(e) => {
              e.preventDefault();
              setCreateModalOpen(webhook);
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

  const renderTable = () => (
    <table className="table mb-3 appbox gbtable">
      <thead>
        <tr>
          <td>WEBHOOK</td>
          <td>ENDPOINT</td>
          <td>SEND PAYLOAD</td>
          <td>SHARED SECRET</td>
          <td>SDKS</td>
          <td>EDIT</td>
        </tr>
      </thead>
      <tbody>{renderTableRows()}</tbody>
    </table>
  );

  return (
    <div className="gb-sdk-connections-webhooks">
      {createModalOpen && (
        <WebhooksModal
          close={() => setCreateModalOpen(null)}
          onSave={mutate}
          current={createModalOpen}
          showSDKMode={true}
          sdkid={sdkid}
        />
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setCreateModalOpen({});
        }}
      >
        Add webhook
      </button>
      {renderTable()}
    </div>
  );
}
