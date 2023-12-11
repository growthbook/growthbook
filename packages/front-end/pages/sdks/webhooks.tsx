import React, { useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import { tr } from "date-fns/locale";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";

export default function SDKWebhooks({ sdkid }) {
  console.log(sdkid, "sdkid", `/webhooks/sdk/${sdkid}`);
  const { data, mutate } = useApi(`/webhooks/sdk/${sdkid}`);
  const [
    createModalOpen,
    setCreateModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);
  const renderTableRows = () => {
    return data?.webhooks.map((webhook) => (
      <tr key={webhook.name}>
        <td>{webhook.name}</td>
        <td>{webhook.endpoint}</td>
        <td>{webhook.sendPayload === true ? "yes" : "no"}</td>
        <td>{webhook.signingKey}</td>
        <td>{webhook.sdks}</td>
        <td>{webhook.status}</td>
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
          <td>STATUS</td>
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
          setCreateModalOpen(true);
        }}
      >
        Add webhook
      </button>
      {renderTable()}
    </div>
  );
}
