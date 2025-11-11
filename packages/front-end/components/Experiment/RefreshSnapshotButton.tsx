import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
} from "back-end/types/experiment-snapshot";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import ManualSnapshotForm from "./ManualSnapshotForm";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  lastAnalysis?: ExperimentSnapshotAnalysis;
  phase: number;
  dimension?: string;
  setAnalysisSettings: (
    settings: ExperimentSnapshotAnalysisSettings | null,
  ) => void;
  resetFilters?: () => void;
  setError: (e: string | undefined) => void;
}> = ({
  mutate,
  experiment,
  lastAnalysis,
  phase,
  dimension,
  setAnalysisSettings,
  resetFilters,
  setError,
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
    setAnalysisSettings(null);
    trackSnapshot(
      "create",
      "RefreshSnapshotButton",
      getDatasourceById(experiment.datasource)?.type || null,
      res.snapshot,
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
        setErrorText={setError}
        onClick={async () => {
          resetFilters?.();
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
        <BsArrowRepeat /> Update
      </Button>
    </>
  );
};

export default RefreshSnapshotButton;
