import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";
import track from "../../services/track";
import { isCloud } from "../../services/env";

const WebhooksModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate }) => {
  const { apiCall } = useAuth();
  const [value, inputProps] = useForm({
    name: "My Webhook",
    endpoint: "",
  });

  const onSubmit = async () => {
    await apiCall("/webhooks", {
      method: "POST",
      body: JSON.stringify(value),
    });
    track("Create Webhook");
    onCreate();
  };

  return (
    <Modal
      close={close}
      header="Create New Key"
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <div className="form-group">
        <label>Display Name</label>
        <input
          type="text"
          {...inputProps.name}
          required
          className="form-control"
        />
      </div>
      <div className="form-group">
        <label>HTTP Endpoint</label>
        <input
          type="url"
          required
          placeholder="https://"
          {...inputProps.endpoint}
          className="form-control"
          onInvalid={(event) => {
            (event.target as HTMLInputElement).setCustomValidity(
              "Please enter a valid URL, including the http:// or https:// prefix."
            );
          }}
        />
        <small className="form-text text-muted">
          Must accept <code>POST</code> requests
          {isCloud() ? (
            <>
              {" "}
              from <code>52.70.79.40</code>
            </>
          ) : (
            ""
          )}
          .
        </small>
      </div>
    </Modal>
  );
};

export default WebhooksModal;
