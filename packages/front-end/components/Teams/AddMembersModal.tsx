import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "@/components/Modal";
import MultiSelectField from "@/components/Forms/MultiSelectField";

export const AddMembersModal = ({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const { teams, refreshOrganization, user, users } = useUser();

  const team = teams?.find((team) => team.id === teamId);

  const form = useForm<{
    members: string[];
  }>({
    defaultValues: {
      members: [],
    },
  });
  const { apiCall } = useAuth();

  const userList = [...users.values()];

  const addableMembers = userList.filter(
    (member) => !member.teams?.includes(teamId) && member.id !== user?.id,
  );

  const handleClose = () => {
    form.setValue("members", []);
    onClose();
  };

  return (
    <Modal
      trackingEventModalType=""
      open={open}
      close={() => handleClose()}
      header={"Add Team Members"}
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
        label="Members to add"
        placeholder="Select members"
        value={form.watch("members")}
        options={addableMembers.map((m) => ({
          value: m.id,
          label: m.email,
        }))}
        onChange={(v) => form.setValue("members", v)}
        customClassName="label-overflow-ellipsis"
        helpText={"Assign users to this team."}
      />
    </Modal>
  );
};
