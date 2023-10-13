import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";

const EditReferenceIdModal: FC<{
  referenceId: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, referenceId }) => {
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      referenceId,
    },
  });

  return (
    <Modal
      header="Edit Organization Reference Id"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        await apiCall("/organization", {
          method: "PUT",
          body: JSON.stringify(value),
        });
        // Update referenceId on settings page
        await mutate();
      })}
      cta="Save"
    >
      <Field
        label="Reference Id: Id used for the organization within your company"
        {...form.register("referenceId")}
      />
    </Modal>
  );
};
export default EditReferenceIdModal;
