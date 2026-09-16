import { useForm } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";

export const AddMembersModal = ({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const { teams, refreshOrganization, users } = useUser();

  const team = teams?.find((team) => team.id === teamId);

  const form = useForm<{
    members: string[];
  }>({
    defaultValues: {
      members: [],
    },
  });
  const { apiCall } = useAuth();

  // The label carries both fields so typing either one filters the list.
  const options = [...users.values()]
    .filter((member) => !member.teams?.includes(teamId))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
    .map((m) => ({ value: m.id, label: `${m.name} ${m.email}`.trim() }));

  const handleClose = () => {
    form.setValue("members", []);
    onClose();
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      open={open}
      close={() => handleClose()}
      header="Add Team Members"
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/teams/${team?.id}/members`, {
          method: "POST",
          body: JSON.stringify({
            members: value.members,
          }),
        });
        refreshOrganization();
      })}
    >
      <MultiSelectField
        legacyHeight
        label="Members to add"
        placeholder="Search by name or email"
        value={form.watch("members")}
        options={options}
        sort={false}
        onChange={(v) => form.setValue("members", v)}
        formatOptionLabel={(option, meta) => {
          const member = users.get(option.value);
          if (!member) return option.label;
          if (meta.context === "value") return member.name || member.email;
          return (
            <Flex direction="column">
              <Text>{member.name || member.email}</Text>
              {member.name && (
                <Text size="sm" color="text-low">
                  {member.email}
                </Text>
              )}
            </Flex>
          );
        }}
        customClassName="label-overflow-ellipsis"
        helpText="Assign users to this team."
      />
    </ModalStandard>
  );
};
