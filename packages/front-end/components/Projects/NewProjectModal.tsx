import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";

export default function NewProjectModal({
  close,
  onSuccess,
}: {
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [value, inputProps] = useForm({
    name: "",
  });

  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header="Create Project"
      submit={async () => {
        await apiCall(`/projects`, {
          method: "POST",
          body: JSON.stringify(value),
        });
        await onSuccess();
      }}
    >
      <div className="form-group">
        Name
        <input
          type="text"
          maxLength={30}
          required
          {...inputProps.name}
          className="form-control"
        />
      </div>
    </Modal>
  );
}
