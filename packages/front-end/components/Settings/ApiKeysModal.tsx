import { FC } from "react";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";
import useForm from "../../hooks/useForm";

const ApiKeysModal: FC<{
  close: () => void;
  onCreate: () => void;
  defaultDescription?: string;
}> = ({ close, onCreate, defaultDescription = "" }) => {
  const { apiCall } = useAuth();
  const [value, inputProps] = useForm({
    description: defaultDescription,
  });

  const onSubmit = async () => {
    await apiCall("/keys", {
      method: "POST",
      body: JSON.stringify(value),
    });
    onCreate();
  };

  return (
    <Modal
      close={close}
      header="Create New Key"
      open={true}
      submit={onSubmit}
      cta="Create"
    >
      <div className="form-group">
        <label>Description (optional)</label>
        <textarea {...inputProps.description} className="form-control" />
      </div>
    </Modal>
  );
};

export default ApiKeysModal;
