import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Text } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import { useExperimentSnapshotUpdate } from "@/hooks/useExperimentSnapshotUpdate";

const RefreshSnapshotButton: FC<{
  mutate: () => void;
  experiment: ExperimentInterfaceStringDates;
  phase: number;
  dimension?: string;
  useRadixButton?: boolean;
  radixVariant?: "outline" | "solid" | "soft";
  setError: (e: string | undefined) => void;
  // Return false to abort the refresh
  customValidation?: () => boolean | Promise<boolean>;
  onSuccess?: () => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
}> = ({
  mutate,
  experiment,
  phase,
  dimension,
  useRadixButton = false,
  radixVariant = "outline",
  setError,
  customValidation,
  onSuccess,
  experimentSnapshotTrackingProps,
}) => {
  const { getDatasourceById } = useDefinitions();

  const trackingProps = experimentSnapshotTrackingProps ?? {
    trackingSource: "RefreshSnapshotButton",
    datasourceType: getDatasourceById(experiment.datasource)?.type || null,
  };

  const { submitUpdate, loading, longResult } = useExperimentSnapshotUpdate({
    experiment,
    phase,
    dimension,
    mutate,
    setRefreshError: (error) => setError(error),
    onSuccess,
    customValidation,
    experimentSnapshotTrackingProps: trackingProps,
  });

  return useRadixButton ? (
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
        onClick={submitUpdate}
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
        <small className="text-muted mr-3">this may take several minutes</small>
      )}
      <Button
        color="outline-primary"
        setErrorText={setError}
        onClick={submitUpdate}
      >
        <BsArrowRepeat /> Update
      </Button>
    </>
  );
};

export default RefreshSnapshotButton;
