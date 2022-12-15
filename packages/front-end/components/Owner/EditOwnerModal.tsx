import { FC } from "react";
import { useForm } from "react-hook-form";
import useMembers from "@/hooks/useMembers";
import Modal from "../Modal";
import Field from "../Forms/Field";

const EditOwnerModal: FC<{
  owner: string;
  save: (ownerName: string) => Promise<void>;
  cancel: () => void;
}> = ({ owner, save, cancel }) => {
  const { memberUsernameOptions } = useMembers();
  const form = useForm({
    defaultValues: {
      owner,
    },
  });

  return (
    <Modal
      header={"Edit Owner"}
      open={true}
      close={cancel}
      submit={form.handleSubmit(async (data) => {
        await save(data.owner);
      })}
      cta="Save"
    >
      <Field
        label="Owner"
        options={memberUsernameOptions}
        comboBox
        {...form.register("owner")}
      />
    </Modal>
  );
};

export default EditOwnerModal;
