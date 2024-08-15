import { ProjectInterface } from "back-end/types/project";
import { useForm } from "react-hook-form";
import { useAuth } from "@front-end/services/auth";
import Modal from "@front-end/components/Modal";
import Field from "@front-end/components/Forms/Field";

export default function ProjectModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<ProjectInterface>;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const form = useForm<Partial<ProjectInterface>>({
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
      header={existing.id ? "Edit Project" : "Create Project"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(existing.id ? `/projects/${existing.id}` : `/projects`, {
          method: existing.id ? "PUT" : "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      })}
    >
      <Field label="Name" maxLength={30} required {...form.register("name")} />
      <Field
        label="Description"
        maxLength={100}
        minRows={3}
        maxRows={8}
        textarea={true}
        {...form.register("description")}
      />
    </Modal>
  );
}
