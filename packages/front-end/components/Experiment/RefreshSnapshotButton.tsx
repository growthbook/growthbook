import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  ExperimentSnapshotInterface,
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
} from "shared/types/experiment-snapshot";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import ManualSnapshotForm from "./ManualSnapshotForm";

type JobStatus = "pending" | "running" | "completed" | "failed";

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
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();
  const manual = !experiment.datasource;

  const pollJobStatus = async (jobId: string): Promise<void> => {
    const pollInterval = 2000; // Poll every 2 seconds
    const maxPolls = 900; // 30 minutes max (900 * 2s = 1800s = 30min)
    let pollCount = 0;

    console.log("Polling job status for job ID:", jobId);
    while (pollCount < maxPolls) {
      const statusRes = await apiCall<{
        status: number;
        jobStatus: JobStatus;
        snapshot?: ExperimentSnapshotInterface;
        error?: string;
      }>(`/experiment/${experiment.id}/snapshot/status/${jobId}`);

      setJobStatus(statusRes.jobStatus);

      if (statusRes.jobStatus === "completed") {
        if (statusRes.snapshot) {
          trackSnapshot(
            "create",
            "RefreshSnapshotButton",
            getDatasourceById(experiment.datasource)?.type || null,
            statusRes.snapshot,
          );
        }
        setAnalysisSettings(null);
        console.log("Snapshot completed, mutating...");
        mutate();
        return;
      }

      if (statusRes.jobStatus === "failed") {
        throw new Error(
          statusRes.error || "Snapshot job failed with unknown error",
        );
      }

      // Still pending or running, wait and poll again
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      pollCount++;
    }

    throw new Error("Snapshot job timed out after 30 minutes");
  };

  const refreshSnapshot = async () => {
    console.log("Requesting snapshot refresh for experiment:", experiment.id);
    // Manual experiments can't refresh automatically, prompt for values in a modal instead
    if (manual) {
      setOpen(true);
      return;
    }

    // Queue the snapshot job
    const res = await apiCall<{
      status: number;
      jobId?: string;
      message: string;
      snapshot?: ExperimentSnapshotInterface;
    }>(`/experiment/${experiment.id}/snapshot`, {
      method: "POST",
      body: JSON.stringify({
        phase,
        dimension,
      }),
    });

    console.log("Snapshot request response:", res);
    // If 202, job was queued - poll for status
    if (res.status === 202 && res.jobId) {
      setJobStatus("pending");
      await pollJobStatus(res.jobId);
    } else if (res.snapshot) {
      // Old path for manual snapshots (status 200)
      setAnalysisSettings(null);
      trackSnapshot(
        "create",
        "RefreshSnapshotButton",
        getDatasourceById(experiment.datasource)?.type || null,
        res.snapshot,
      );
      console.log("Snapshot completed, mutating...");
      mutate();
    }
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
        <small className="text-muted mr-3">
          {jobStatus === "pending" && "Snapshot queued, waiting to start..."}
          {jobStatus === "running" &&
            "Snapshot running, this may take several minutes..."}
          {!jobStatus && "this may take several minutes"}
        </small>
      )}
      <Button
        color="outline-primary"
        setErrorText={setError}
        onClick={async () => {
          resetFilters?.();
          setLoading(true);
          setLongResult(false);
          setJobStatus(null);

          const timer = setTimeout(() => {
            setLongResult(true);
          }, 5000);

          try {
            await refreshSnapshot();
            setLoading(false);
            setJobStatus(null);
            clearTimeout(timer);
          } catch (e) {
            setLoading(false);
            setJobStatus(null);
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
