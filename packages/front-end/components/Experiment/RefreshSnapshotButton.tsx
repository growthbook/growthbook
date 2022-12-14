import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useAuth } from "@/services/auth";
import Button from "../Button";
import ManualSnapshotForm from "./ManualSnapshotForm";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  lastSnapshot?: ExperimentSnapshotInterface;
  phase: number;
  dimension?: string;
}> = ({ mutate, experiment, lastSnapshot, phase, dimension }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);

  const { apiCall } = useAuth();
  const manual = !experiment.datasource;

  const refreshSnapshot = async () => {
    // Manual experiments can't refresh automatically, prompt for values in a modal instead
    if (manual) {
      setOpen(true);
      return;
    }

    await apiCall<{ status: number; message: string }>(
      `/experiment/${experiment.id}/snapshot`,
      {
        method: "POST",
        body: JSON.stringify({
          phase,
          dimension,
        }),
      }
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
          lastSnapshot={lastSnapshot}
        />
      )}
      {loading && longResult && (
        <small className="text-muted mr-3">this may take several minutes</small>
      )}
      <Button
        color="outline-primary"
        onClick={async () => {
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
        <BsArrowRepeat /> Update Data
      </Button>
    </>
  );
};

export default RefreshSnapshotButton;
