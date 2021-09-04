import { ProjectInterface } from "back-end/types/project";
import useForm from "../../hooks/useForm";
import { useAuth } from "../../services/auth";
import MetricsSelector from "../Experiment/MetricsSelector";
import Modal from "../Modal";

export default function ProjectModal({
  existing,
  close,
  onSuccess,
}: {
  existing: Partial<ProjectInterface>;
  close: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [value, inputProps, manualUpdate] = useForm<Partial<ProjectInterface>>({
    name: existing.name || "",
    metrics: existing.metrics || [],
    dimensions: existing.dimensions || [],
    segments: existing.segments || [],
  });

  const { apiCall } = useAuth();

  return (
    <Modal
      open={true}
      close={close}
      header="Create Project"
      submit={async () => {
        await apiCall(existing.id ? `/projects/${existing.id}` : `/projects`, {
          method: existing.id ? "PUT" : "POST",
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
      <div className="form-group">
        Metrics
        <MetricsSelector
          selected={value.metrics}
          onChange={(metrics) => {
            manualUpdate({
              metrics,
            });
          }}
        />
      </div>
    </Modal>
  );
}
