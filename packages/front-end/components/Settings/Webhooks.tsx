import { FC, useState } from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import { WebhookInterface } from "back-end/types/webhook";
import DeleteButton from "../DeleteButton";
import { useAuth } from "../../services/auth";
import WebhooksModal from "./WebhooksModal";
import { ago } from "../../services/dates";
import { FaCheck, FaBolt } from "react-icons/fa";

const Webhooks: FC = () => {
  const { data, error, mutate } = useApi<{ webhooks: WebhookInterface[] }>(
    "/webhooks"
  );
  const { apiCall } = useAuth();
  const [open, setOpen] = useState(false);

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div>
      {open && <WebhooksModal close={() => setOpen(false)} onCreate={mutate} />}
      <p>
        Webhooks push the latest experiment overrides to your server whenever an
        experiment is modified within the GrowthBook app.{" "}
        <a
          href="https://docs.growthbook.io/app/webhooks"
          target="_blank"
          rel="noreferrer"
        >
          View Documentation
        </a>
      </p>

      {data.webhooks.length > 0 && (
        <table className="table mb-3">
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
                  <DeleteButton
                    onClick={async () => {
                      await apiCall(`/webhook/${webhook.id}`, {
                        method: "DELETE",
                      });
                      mutate();
                    }}
                    displayName="Webhook"
                    className="tr-hover"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <button
        className="btn btn-success"
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        <FaBolt /> Create Webhook
      </button>
    </div>
  );
};

export default Webhooks;
