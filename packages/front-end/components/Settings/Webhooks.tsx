import React, { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { WebhookInterface } from "back-end/types/webhook";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import WebhooksModal from "./WebhooksModal";
import { ago } from "../../services/dates";
import { FaCheck, FaBolt, FaPencilAlt } from "react-icons/fa";

const Webhooks: FC = () => {
  const { data, error, mutate } = useApi<{ webhooks: WebhookInterface[] }>(
    "/webhooks"
  );
  const { apiCall } = useAuth();
  const [open, setOpen] = useState<null | Partial<WebhookInterface>>(null);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {open && (
        <WebhooksModal
          close={() => setOpen(null)}
          onSave={mutate}
          current={open}
        />
      )}
      <p>
        Webhooks push the latest feature definitions to your server whenever
        they are modified within the GrowthBook app.{" "}
        <a
          href="https://docs.growthbook.io/app/webhooks"
          target="_blank"
          rel="noreferrer"
        >
          View Documentation
        </a>
      </p>

      {data.webhooks.length > 0 && (
        <table className="table mb-3 appbox gbtable hover-highlight">
          <thead>
            <tr>
              <th>Webhook</th>
              <th>Endpoint</th>
              <th>Shared Secret</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.webhooks.map((webhook) => (
              <tr key={webhook.id}>
                <td>{webhook.name}</td>
                <td>{webhook.endpoint}</td>
                <td>
                  <code>{webhook.signingKey}</code>
                </td>
                <td>
                  {webhook.error ? (
                    <pre className="text-danger">{webhook.error}</pre>
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
                      setOpen(webhook);
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
            ))}
          </tbody>
        </table>
      )}

      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setOpen({});
        }}
      >
        <FaBolt /> Create Webhook
      </button>
    </div>
  );
};

export default Webhooks;
