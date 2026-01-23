import { FC, useState } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { Text } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { trackSnapshot } from "@/services/track";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  dimension?: string;
  useRadixButton?: boolean;
  radixVariant?: "outline" | "solid" | "soft";
  setError: (e: string | undefined) => void;
}> = ({
  mutate,
  experiment,
  phase,
  dimension,
  useRadixButton = false,
  radixVariant = "outline",
  setError,
}) => {
  const [loading, setLoading] = useState(false);
  const [longResult, setLongResult] = useState(false);
  const { getDatasourceById } = useDefinitions();

  const { apiCall } = useAuth();

  const refreshSnapshot = async () => {
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
      res.snapshot,
    );
    mutate();
  };

  return (
    <>
      {useRadixButton ? (
        <>
          {loading && longResult && (
            <Text size="1" color="gray" mr="3">
              this may take several minutes
            </Text>
          )}
          <RadixButton
            variant={radixVariant}
            size="sm"
            disabled={loading}
            setError={(error) => setError(error ?? undefined)}
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
            style={{
              minWidth: 110,
            }}
            icon={<PiArrowClockwise />}
          >
            Update
          </RadixButton>
        </>
      ) : (
        <>
          {loading && longResult && (
            <small className="text-muted mr-3">
              this may take several minutes
            </small>
          )}
          <Button
            color="outline-primary"
            setErrorText={setError}
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
            <BsArrowRepeat /> Update
          </Button>
        </>
      )}
    </>
  );
};

export default RefreshSnapshotButton;
