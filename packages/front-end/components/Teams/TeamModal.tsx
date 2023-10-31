import { useForm } from "react-hook-form";
import { MemberRoleWithProjects } from "back-end/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { Team } from "@/services/UserContext";
import RoleSelector from "../Settings/Team/RoleSelector";

export default function TeamModal({
  existing,
  close,
  onSuccess,
  managedByIdp = false,
}: {
  existing: Partial<Team>;
  close: () => void;
  onSuccess?: () => Promise<unknown>;
  managedByIdp?: boolean;
}) {
  const form = useForm<{
    name: string;
    description: string;
    roleInfo: MemberRoleWithProjects;
  }>({
    defaultValues: {
      name: existing.name || "",
      description: existing.description || "",
      roleInfo: {
        role: existing.role || "collaborator",
        limitAccessByEnvironment: existing.limitAccessByEnvironment || false,
        environments: existing.environments || [],
        projectRoles: existing.projectRoles || [],
      },
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header={existing.id ? "Edit Team Metadata" : "Create Team"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(existing.id ? `/teams/${existing.id}` : `/teams`, {
          method: existing.id ? "PUT" : "POST",
          body: JSON.stringify({
            name: value.name,
            description: value.description,
            permissions: { ...value.roleInfo },
          }),
        });
        onSuccess ? await onSuccess() : null;
      })}
    >
      <Field
        disabled={managedByIdp}
        label="Name"
        maxLength={30}
        required
        {...form.register("name")}
      />
      <Field
        label="Description"
        maxLength={100}
        minRows={3}
        maxRows={8}
        textarea={true}
        {...form.register("description")}
      />
      {!existing.id && (
        <RoleSelector
          value={form.watch("roleInfo")}
          setValue={(value) => form.setValue("roleInfo", value)}
        />
      )}
    </Modal>
  );
}
