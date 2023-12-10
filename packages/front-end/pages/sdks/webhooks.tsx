import React, { useState } from "react";
import { WebhookInterface } from "back-end/types/webhook";
import useApi from "@/hooks/useApi";
import WebhooksModal from "@/components/Settings/WebhooksModal";

export default function SDKWebhooks() {
  const { data, mutate } = useApi("/sdk-webhooks");
  const [
    createModalOpen,
    setCreateModalOpen,
  ] = useState<null | Partial<WebhookInterface>>(null);

  return (
    <div className="gb-sdk-connections-webhooks">
      {createModalOpen && (
        <WebhooksModal
          close={() => setCreateModalOpen(null)}
          onSave={mutate}
          current={createModalOpen}
          showSDKMode={true}
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
      </table>
    </div>
  );
}
