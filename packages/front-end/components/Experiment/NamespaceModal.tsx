import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { Namespaces } from "back-end/types/organization";

export default function NamespaceModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<Namespaces>;
  close: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const form = useForm<Partial<Namespaces>>({
    defaultValues: {
      name: existing.name || "",
      description: existing.description || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      cta={existing.name ? "Update" : "Create"}
      header={existing.name ? "Edit Namespace" : "Create Namespace"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(
          existing.name
            ? `/organization/namespaces/${existing.name}`
            : `/organization/namespaces`,
          {
            method: existing.name ? "PUT" : "POST",
            body: JSON.stringify(value),
          }
        );
        await onSuccess();
      })}
    >
      <Field
        name="Name"
        label="Name"
        maxLength={60}
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
