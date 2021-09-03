import { ProjectInterface } from "../../../back-end/types/project";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import Modal from "../Modal";

export default function EditProjectModal({
  project,
  close,
  onSuccess,
}: {
  project: ProjectInterface;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [value, inputProps] = useForm({
    name: project.name,
  });

  const { apiCall } = useAuth();

  if (!project) return null;

  return (
    <Modal
      open={true}
      close={close}
      header="Edit Project"
      submit={async () => {
        await apiCall(`/projects/${project.id}`, {
          method: "PUT",
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
