import { useForm } from "react-hook-form";
import { Namespaces } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

export default function NamespaceModal({
  close,
  onSuccess,
  existing,
}: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
  existing: {
    namespace: Namespaces;
    experiments: number;
  } | null;
}) {
  const existingNamespace = existing?.namespace;
  const form = useForm<Partial<Namespaces>>({
    defaultValues: {
      label: existingNamespace?.label || existingNamespace?.name || "",
      description: existingNamespace?.description || "",
      status: existingNamespace?.status || "active",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      cta={existing ? "Update" : "Create"}
      header={existing ? "Edit Namespace" : "Create Namespace"}
      submit={form.handleSubmit(async (value) => {
        if (existing) {
          await apiCall(
            `/organization/namespaces/${
              existingNamespace?.name
                ? encodeURIComponent(existingNamespace.name)
                : ""
            }`,
            {
              method: "PUT",
              body: JSON.stringify(value),
            },
          );
        } else {
          await apiCall(`/organization/namespaces`, {
            method: "POST",
            body: JSON.stringify(value),
          });
        }
        await onSuccess();
      })}
    >
      <Field label="Name" maxLength={60} required {...form.register("label")} />
      <Field label="Description" textarea {...form.register("description")} />
    </Modal>
  );
}
