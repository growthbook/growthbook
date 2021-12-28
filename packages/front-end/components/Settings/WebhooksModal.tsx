import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import { isCloud } from "../../services/env";
import Field from "../Forms/Field";
import { WebhookInterface } from "back-end/types/webhook";

const WebhooksModal: FC<{
  close: () => void;
  onSave: () => void;
  defaultDescription?: string;
  current: Partial<WebhookInterface>;
}> = ({ close, onSave, current }) => {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      name: current.name || "My Webhook",
      endpoint: current.endpoint || "",
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall(current.id ? `/webhook/${current.id}` : "/webhooks", {
      method: current.id ? "PUT" : "POST",
      body: JSON.stringify(value),
    });
    track(current.id ? "Edit Webhook" : "Create Webhook");
    onSave();
  });

  return (
    <Modal
      close={close}
      header={current.id ? "Update Webhook" : "Create New Webhook"}
      open={true}
      submit={onSubmit}
      cta={current.id ? "Update" : "Create"}
    >
      <Field label="Display Name" required {...form.register("name")} />
      <Field
        label="HTTP Endpoint"
        type="url"
        required
        placeholder="https://"
        {...form.register("endpoint")}
        onInvalid={(event) => {
          (event.target as HTMLInputElement).setCustomValidity(
            "Please enter a valid URL, including the http:// or https:// prefix."
          );
        }}
        helpText={
          <>
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
          </>
        }
      />
    </Modal>
  );
};

export default WebhooksModal;
