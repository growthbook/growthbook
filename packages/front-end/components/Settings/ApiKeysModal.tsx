import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import { useForm } from "react-hook-form";
import track from "../../services/track";
import Field from "../Forms/Field";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      description: defaultDescription,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(value),
    });
    track("Create API Key");
    onCreate();
  });

  return (
    <Modal
      close={close}
      header="Create New Key"
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <Field label="Description (optional)" {...form.register("description")} />
    </Modal>
  );
};

export default ApiKeysModal;
