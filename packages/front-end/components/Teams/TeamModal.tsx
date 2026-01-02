import { useForm } from "react-hook-form";
import { MemberRoleWithProjects } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { Team } from "@/services/UserContext";
import RoleSelector from "@/components/Settings/Team/RoleSelector";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";

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
  const { projects } = useDefinitions();
  const availableProjects: SingleValue[] = projects
    .slice()
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((p) => ({ value: p.id, label: p.name }));

  const form = useForm<{
    name: string;
    description: string;
    roleInfo: MemberRoleWithProjects;
    defaultProject: string;
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
      defaultProject: existing.defaultProject || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
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
            defaultProject: value.defaultProject || "",
          }),
        });
        onSuccess && (await onSuccess());
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
        <div className="mb-3">
          <RoleSelector
            value={form.watch("roleInfo")}
            setValue={(value) => form.setValue("roleInfo", value)}
          />
        </div>
      )}
      {availableProjects.length > 0 && (
        <SelectField
          label="Default Project"
          value={form.watch("defaultProject")}
          onChange={(p) => form.setValue("defaultProject", p)}
          name="project"
          initialOption="All Projects"
          options={availableProjects}
        />
      )}
    </Modal>
  );
}
