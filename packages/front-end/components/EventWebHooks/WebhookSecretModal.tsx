import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";

export default function WebhookSecretModal({
  existingId,
  close,
}: {
  existingId?: string;
  close: () => void;
}) {
  const { webhookSecrets, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();

  const existing = existingId
    ? webhookSecrets.find((secret) => secret.id === existingId)
    : undefined;

  const form = useForm({
    defaultValues: {
      key: existing?.key || "",
      description: existing?.description || "",
      value: "",
    },
  });

  return (
    <Modal
      open={true}
      close={close}
      trackingEventModalType={`webhook_secret_${existingId ? "edit" : "add"}`}
      header={existingId ? "Edit Secret" : "Add Secret"}
      submit={form.handleSubmit(async (data) => {
        if (existingId) {
          await apiCall(`/webhook-secrets/${existingId}`, {
            method: "PUT",
            // Cannot change the key
            body: JSON.stringify({
              description: data.description,
              value: data.value,
            }),
          });
        } else {
          await apiCall("/webhook-secrets", {
            method: "POST",
            body: JSON.stringify(data),
          });
        }
        await mutateDefinitions();
      })}
    >
      <Field
        autoComplete="off"
        {...form.register("key")}
        label="Key"
        required
        disabled={!!existingId}
        helpText="This is what you reference within your webhook endpoint or headers"
      />
      <Field
        autoComplete="off"
        {...form.register("value")}
        label="Value"
        required={!existingId}
        placeholder={existingId ? "(keep existing)" : ""}
      />
      <Field
        {...form.register("description")}
        label="Description"
        textarea
        placeholder="(optional)"
      />
    </Modal>
  );
}
