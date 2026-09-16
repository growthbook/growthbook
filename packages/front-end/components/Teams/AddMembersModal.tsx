import { useState } from "react";
import { useForm } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import MultiSelectField from "@/ui/MultiSelectField";
import Text from "@/ui/Text";

// Organizations run to thousands of members, so the list is search-first:
// nothing renders until there is a query, and only the closest matches show.
const MAX_MATCHES = 50;

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
  const [query, setQuery] = useState("");

  const team = teams?.find((team) => team.id === teamId);

  const form = useForm<{
    members: string[];
  }>({
    defaultValues: {
      members: [],
    },
  });
  const { apiCall } = useAuth();

  const addable = [...users.values()].filter(
    (member) => !member.teams?.includes(teamId),
  );
  const selected = form.watch("members");
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? addable
        .filter(
          (m) =>
            m.name.toLowerCase().includes(needle) ||
            m.email.toLowerCase().includes(needle),
        )
        .slice(0, MAX_MATCHES)
    : [];
  // Selected members stay in the option list so their chips keep a label.
  const options = [
    ...matches,
    ...addable.filter(
      (m) => selected.includes(m.id) && !matches.some((x) => x.id === m.id),
    ),
  ].map((m) => ({ value: m.id, label: `${m.name} ${m.email}`.trim() }));

  const handleClose = () => {
    form.setValue("members", []);
    setQuery("");
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
        value={selected}
        options={options}
        sort={false}
        onChange={(v) => form.setValue("members", v)}
        onInputChange={setQuery}
        noOptionsMessage={(input) =>
          input.trim() ? "No members match" : "Type a name or email"
        }
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
        helpText="Members already on this team are left out."
      />
    </ModalStandard>
  );
};
