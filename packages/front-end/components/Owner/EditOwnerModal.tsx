import { FC } from "react";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import Field from "../Forms/Field";
import useMembers from "../../hooks/useMembers";

const EditTagsForm: FC<{
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
        listId="editOwner"
        {...form.register("owner")}
      />
    </Modal>
  );
};

export default EditTagsForm;
