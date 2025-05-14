import { useForm } from "react-hook-form";
import Modal from "@/components/Modal";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";

export default function WebhookSecretModal({
  existingId,
  close,
}: {
  existingId?: string;
  close: () => void;
}) {
  const { webhookSecrets, mutateDefinitions } = useDefinitions();

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
          await fetch(`/webhook-secrets/${existingId}`, {
            method: "PUT",
            // Cannot change the key
            body: JSON.stringify({
              description: data.description,
              value: data.value,
            }),
          });
        } else {
          await fetch("/webhook-secrets", {
            method: "POST",
            body: JSON.stringify(data),
          });
        }
        await mutateDefinitions();
      })}
    >
      <Field
        {...form.register("key")}
        label="Key"
        required
        disabled={!!existingId}
        helpText="This is what you reference within your webhook endpoint or headers"
      />
      <Field
        {...form.register("value")}
        type="password"
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
