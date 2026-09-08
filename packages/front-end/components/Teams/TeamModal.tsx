import { useForm } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import { MemberRoleWithProjects } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import { Team } from "@/services/UserContext";
import RoleRulesTable from "@/components/Settings/Team/RoleRulesTable";
import SelectField, { SingleValue } from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";
import Heading from "@/ui/Heading";

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
        additionalRoles: existing.additionalRoles || [],
        projectRoles: existing.projectRoles || [],
      },
      defaultProject: existing.defaultProject || "",
    },
  });
  const { apiCall } = useAuth();

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header={existing.id ? "Edit Team Settings" : "Create Team"}
      size={existing.id ? undefined : "xl"}
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
        size="legacy"
        disabled={managedByIdp}
        label="Name"
        maxLength={30}
        required
        {...form.register("name")}
      />
      <Field
        size="legacy"
        label="Description"
        maxLength={100}
        minRows={1}
        maxRows={8}
        textarea={true}
        {...form.register("description")}
      />
      {availableProjects.length > 0 && (
        <SelectField
          size="legacy"
          label="Default Project"
          value={form.watch("defaultProject")}
          onChange={(p) => form.setValue("defaultProject", p)}
          name="project"
          initialOption="All Projects"
          options={availableProjects}
        />
      )}
      {!existing.id && (
        <Box mt="4">
          <Heading as="h4" size="sm" mb="1">
            Permissions
          </Heading>
          <Text as="p" size="sm" color="text-low" mb="3">
            Members of this team get these on top of their own roles.
          </Text>
          <RoleRulesTable
            value={form.watch("roleInfo")}
            setValue={(value) => form.setValue("roleInfo", value)}
          />
        </Box>
      )}
    </ModalStandard>
  );
}
