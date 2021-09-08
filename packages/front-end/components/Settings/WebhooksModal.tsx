import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import { isCloud } from "../../services/env";
import Field from "../Forms/Field";

const WebhooksModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate }) => {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      name: "My Webhook",
      endpoint: "",
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/webhooks", {
      method: "POST",
      body: JSON.stringify(value),
    });
    track("Create Webhook");
    onCreate();
  });

  return (
    <Modal
      close={close}
      header="Create New Key"
      open={true}
      submit={onSubmit}
      cta="Create"
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
