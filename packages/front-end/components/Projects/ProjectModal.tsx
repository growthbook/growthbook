import { ProjectInterface } from "shared/types/project";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

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
      publicId: existing.publicId || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
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
        label="Public ID"
        maxLength={64}
        placeholder="Auto-generated from name if left blank"
        helpText="A URL-safe identifier that can be included in SDK payloads. Uses lowercase letters, numbers, and dashes only."
        {...form.register("publicId")}
      />
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
