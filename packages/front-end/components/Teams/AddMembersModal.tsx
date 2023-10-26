import { TeamInterface } from "back-end/types/team";
import { useForm } from "react-hook-form";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import Modal from "../Modal";
import MultiSelectField from "../Forms/MultiSelectField";

export const AddMembersModal = ({
  teamId,
  open,
  onClose,
}: {
  teamId: string;
  open: boolean;
  onClose: () => void;
}) => {
  const { data, mutate } = useApi<{
    team: TeamInterface;
  }>(`/teams/${teamId}`);

  const form = useForm<{
    members: string[];
  }>({
    defaultValues: {
      members: data?.team.members?.map((m) => m.id) || [],
    },
  });
  const { apiCall } = useAuth();
  const { users, refreshOrganization } = useUser();

  const userList = [...users.values()];

  const addableMembers = userList.filter(
    (member) => !member.teams?.includes(teamId)
  );

  const handleClose = () => {
    form.setValue("members", []);
    onClose();
  };

  return (
    <Modal
      open={open}
      close={() => handleClose()}
      header={"Add Team Members"}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/teams/${data?.team.id}/members`, {
          method: "POST",
          body: JSON.stringify({
            members: value.members,
          }),
        });
        mutate();
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
