import { useForm } from "react-hook-form";
import { Namespaces } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";

export default function NamespaceModal({
  close,
  onSuccess,
  existing,
}: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
  existing?: {
    namespace: Namespaces;
    experiments: number;
  };
}) {
  const existingNamespace = existing?.namespace;
  const form = useForm<Partial<Namespaces>>({
    defaultValues: {
      name: existingNamespace?.name || "",
      description: existingNamespace?.description || "",
      status: existingNamespace?.status || "active",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      cta={existing ? "Update" : "Create"}
      header={existing ? "Edit Namespace" : "Create Namespace"}
      submit={form.handleSubmit(async (value) => {
        if (existing) {
          await apiCall(`/organization/namespaces/${existingNamespace.name}`, {
            method: "PUT",
            body: JSON.stringify(value),
          });
        } else {
          await apiCall(`/organization/namespaces`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        await onSuccess();
      })}
    >
      <Field
        name="Name"
        label="Name"
        maxLength={60}
        disabled={!!existing?.experiments}
        required
        {...form.register("name")}
      />
      <Field
        name="Description"
        label="Description"
        textarea
        {...form.register("description")}
      />
    </Modal>
  );
}
