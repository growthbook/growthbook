import { ProjectInterface } from "shared/types/project";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { useForm } from "react-hook-form";
import { postProjectValidator, putProjectValidator } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import Field from "@/components/Forms/Field";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

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
  const restApiCall = useRestApiCall();

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={existing.id ? "Edit Project" : "Create Project"}
      submit={form.handleSubmit(async (value) => {
        const body = {
          name: value.name || "",
          description: value.description,
          publicId: value.publicId,
        };
        if (existing.id) {
          await restApiCall(putProjectValidator, {
            params: { id: existing.id },
            body,
          });
        } else {
          await restApiCall(postProjectValidator, { body });
        }
        await onSuccess();
      })}
    >
      <Field label="Name" maxLength={30} required {...form.register("name")} />
      <Field
        label="Public ID"
        maxLength={64}
        pattern="^[a-z0-9-]+$"
        placeholder="Auto-generated from name if left blank"
        helpText="A URL-safe identifier that can be included in SDK payloads. Uses lowercase letters, numbers, and dashes only."
        {...form.register("publicId")}
      />
      <Field
        label="Description"
        maxLength={MAX_DESCRIPTION_LENGTH}
        minRows={3}
        maxRows={8}
        textarea={true}
        {...form.register("description")}
      />
    </ModalStandard>
  );
}
