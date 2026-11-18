import { useForm } from "react-hook-form";
import { UpdateWebhookSecretProps } from "shared/validators";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";
import StringArrayField from "@/ui/StringArrayField";
import { KEEP_EXISTING_PLACEHOLDER } from "@/components/Forms/secretInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

export default function WebhookSecretModal({
  existingId,
  close,
  onSuccess,
}: {
  existingId?: string;
  close: () => void;
  onSuccess?: (webhookSecretKey: string) => void;
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
      allowedOrigins: existing?.allowedOrigins || [],
      value: "",
    },
  });

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType={`webhook_secret_${existingId ? "edit" : "add"}`}
      header={existingId ? "Edit Secret" : "Add Secret"}
      submit={validatedSubmit(form, async (data) => {
        // Validation for allowed origins
        if (data.allowedOrigins?.length) {
          if (!data.allowedOrigins.every((o) => o.startsWith("http"))) {
            throw new Error("All origins must start with http or https");
          }

          // Make sure all origins are valid and normalized
          data.allowedOrigins = data.allowedOrigins.map(
            (origin) => new URL(origin).origin,
          );

          // Remove duplicates
          data.allowedOrigins = [...new Set(data.allowedOrigins)];
        }

        if (existingId) {
          const body: UpdateWebhookSecretProps = {
            description: data.description,
            allowedOrigins: data.allowedOrigins,
          };
          // Don't update the value if it's empty
          if (data.value) {
            body.value = data.value;
          }

          await apiCall(`/webhook-secrets/${existingId}`, {
            method: "PUT",
            // Cannot change the key
            body: JSON.stringify(body),
          });
        } else {
          await apiCall("/webhook-secrets", {
            method: "POST",
            body: JSON.stringify(data),
          });
        }
        await mutateDefinitions();
        if (onSuccess) {
          onSuccess(data.key);
        }
      })}
    >
      <Field
        size="legacy"
        autoComplete="off"
        {...form.register("key")}
        label="Key"
        required
        disabled={!!existingId}
        helpText="This is what you reference within your webhook endpoint or headers"
      />
      <Field
        size="legacy"
        autoComplete="off"
        {...form.register("value")}
        label="Value"
        required={!existingId}
        placeholder={existingId ? KEEP_EXISTING_PLACEHOLDER : ""}
      />
      <Field
        size="legacy"
        {...form.register("description")}
        label="Description"
        textarea
        placeholder="(optional)"
      />
      <StringArrayField
        legacyHeight
        value={form.watch("allowedOrigins")}
        onChange={(value) => form.setValue("allowedOrigins", value)}
        label="Restrict to Specific Origins"
        helpText="Only allow using this secret in requests to the specified origins. Leave empty for no origin restrictions."
      />
    </ModalStandard>
  );
}
