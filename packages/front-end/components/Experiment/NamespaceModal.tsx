import { useForm } from "react-hook-form";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import Field from "../Forms/Field";
import { Namespaces } from "back-end/types/organization";

export default function NamespaceModal({
  close,
  onSuccess,
}: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
}) {
  const form = useForm<Partial<Namespaces>>({
    defaultValues: {
      name: "",
      description: "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      cta="Create"
      header="Create Namespace"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/organization/namespaces`, {
          method: "POST",
          body: JSON.stringify(value),
        });
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
