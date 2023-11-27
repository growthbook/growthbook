import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
} from "back-end/types/experiment-snapshot";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "../Button";
import ManualSnapshotForm from "./ManualSnapshotForm";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  lastAnalysis?: ExperimentSnapshotAnalysis;
  phase: number;
  dimension?: string;
  onSubmit?: () => void;
  newUi?: boolean;
}> = ({
  mutate,
  experiment,
  lastAnalysis,
  phase,
  dimension,
  onSubmit,
  newUi = false,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();
  const manual = !experiment.datasource;

  const refreshSnapshot = async () => {
    // Manual experiments can't refresh automatically, prompt for values in a modal instead
    if (manual) {
      setOpen(true);
      return;
    }

    const res = await apiCall<{
      status: number;
      message: string;
      snapshot: ExperimentSnapshotInterface;
    }>(`/experiment/${experiment.id}/snapshot`, {
      method: "POST",
      body: JSON.stringify({
        phase,
        dimension,
      }),
    });
    trackSnapshot(
      "create",
      "RefreshSnapshotButton",
      getDatasourceById(experiment.datasource)?.type || null,
      res.snapshot
    );
    mutate();
  };

  return (
    <>
      {open && (
        <ManualSnapshotForm
          phase={phase}
          close={() => setOpen(false)}
          experiment={experiment}
          success={mutate}
          lastAnalysis={lastAnalysis}
        />
      )}
      {loading && longResult && (
        <small className="text-muted mr-3">this may take several minutes</small>
      )}
      <Button
        color="outline-primary"
        onClick={async () => {
          onSubmit?.();
          setLoading(true);
          setLongResult(false);

          const timer = setTimeout(() => {
            setLongResult(true);
          }, 5000);

          try {
            await refreshSnapshot();
            setLoading(false);
            clearTimeout(timer);
          } catch (e) {
            setLoading(false);
            clearTimeout(timer);
            throw e;
          }
        }}
      >
        <BsArrowRepeat />
        {newUi ? " Update" : " Update Data"}
      </Button>
    </>
  );
};

export default RefreshSnapshotButton;
