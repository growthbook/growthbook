import {
  MetricDefinitionInterface,
  MetricInterface,
} from "shared/types/metric";
import MetricForm from "@/components/Metrics/MetricForm";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/ui/Modal";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

export type MetricModalState = {
  currentMetric?: MetricDefinitionInterface;
  mode: "edit" | "duplicate";
};

export type MetricModalProps = MetricModalState & {
  close: () => void;
  source: string;
};

export function MetricModal({
  close,
  mode,
  source,
  currentMetric,
}: MetricModalProps) {
  if (currentMetric) {
    return (
      <EditMetricModal
        close={close}
        mode={mode}
        source={source}
        currentMetric={currentMetric}
      />
    );
  } else {
    // This should never happen
    return null;
  }
}

// Metrics coming from the definitions endpoint are missing heavy fields like
// `sql`, so fetch the full metric before seeding the form. Otherwise saving an
// edit would silently wipe those fields.
function EditMetricModal({
  close,
  mode,
  source,
  currentMetric,
}: {
  close: () => void;
  mode: "edit" | "duplicate";
  source: string;
  currentMetric: MetricDefinitionInterface;
}) {
  const { data, error } = useApi<{ metric: MetricInterface }>(
    `/metric/${currentMetric.id}`,
  );

  if (error) {
    return (
      <Modal.Root
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        dismissible
        hasDescription={false}
        trackingEventModalType=""
      >
        <Modal.Header>
          <Modal.Title>
            {mode === "edit" ? "Edit Metric" : "Duplicate Metric"}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Callout status="error">{error.message}</Callout>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Root>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // When duplicating, apply only the caller's intended overrides on top of the
  // full fetched metric — the rest of currentMetric is a possibly-stale
  // definitions copy
  const current: MetricInterface =
    mode === "edit"
      ? data.metric
      : {
          ...data.metric,
          name: currentMetric.name,
          managedBy: currentMetric.managedBy,
        };

  return (
    <MetricForm
      current={current}
      edit={mode === "edit"}
      duplicate={mode === "duplicate"}
      source={source + (mode === "duplicate" ? "-duplicate" : "")}
      onClose={close}
    />
  );
}
