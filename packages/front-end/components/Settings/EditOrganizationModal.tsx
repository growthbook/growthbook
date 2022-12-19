import { FC } from "react";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";

const EditOrganizationModal: FC<{
  name: string;
  close: () => void;
  mutate: () => Promise<unknown>;
}> = ({ close, mutate, name }) => {
  const { apiCall, setOrgName } = useAuth();

  const form = useForm({
    defaultValues: {
      name,
    },
  });

  return (
    <Modal
      header="Edit Organization Name"
      open={true}
      close={close}
      submit={form.handleSubmit(async (value) => {
        await apiCall("/organization", {
          method: "PUT",
          body: JSON.stringify(value),
        });
        // Update org name in global context (e.g. top nav)
        setOrgName(value.name);
        // Update org name on settings page
        await mutate();
      })}
      cta="Save"
    >
      <Field label="Organization Name" required {...form.register("name")} />
    </Modal>
  );
};
export default EditOrganizationModal;
