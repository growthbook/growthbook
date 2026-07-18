import { FC } from "react";
import { BsArrowRepeat } from "react-icons/bs";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Text } from "@radix-ui/themes";
import { PiArrowClockwise } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import Button from "@/components/Button";
import RadixButton from "@/ui/Button";
import {
  type SnapshotRefreshBlocker,
  useExperimentSnapshotUpdate,
} from "@/hooks/useExperimentSnapshotUpdate";
import FullRefreshRequiredDialog from "@/components/Experiment/FullRefreshRequiredDialog";

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
  onSnapshotRefreshBlocked?: (blocker: SnapshotRefreshBlocker) => void;
  experimentSnapshotTrackingProps?: {
    trackingSource: string;
    datasourceType: string | null;
  };
  fullRefreshRequired?: boolean;
  fullRefreshReasons?: string[];
  disabled?: boolean;
}> = ({
  mutate,
  experiment,
  phase,
  dimension,
  useRadixButton = true,
  radixVariant = "outline",
  setError,
  customValidation,
  onSuccess,
  onSnapshotRefreshBlocked,
  experimentSnapshotTrackingProps,
  fullRefreshRequired = false,
  fullRefreshReasons = [],
  disabled = false,
}) => {
  const { getDatasourceById } = useDefinitions();

  const trackingProps = experimentSnapshotTrackingProps ?? {
    trackingSource: "RefreshSnapshotButton",
    datasourceType: getDatasourceById(experiment.datasource)?.type || null,
  };

  const { submitUpdate, loading, longResult, fullRefreshConfirm } =
    useExperimentSnapshotUpdate({
      experiment,
      phase,
      dimension,
      mutate,
      setRefreshError: (error) => setError(error),
      onSuccess,
      customValidation,
      onSnapshotRefreshBlocked,
      experimentSnapshotTrackingProps: trackingProps,
    });

  const label = fullRefreshRequired ? "Full Refresh" : "Update";
  const handleClick = fullRefreshRequired
    ? () => submitUpdate({ force: true, fullRefreshReasons })
    : () => submitUpdate();

  return (
    <>
      <FullRefreshRequiredDialog controller={fullRefreshConfirm} />
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
            disabled={loading || disabled}
            setError={(error) => setError(error ?? undefined)}
            onClick={handleClick}
            style={{
              minWidth: 110,
            }}
            icon={<PiArrowClockwise />}
          >
            {label}
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
            onClick={handleClick}
            disabled={loading || disabled}
          >
            <BsArrowRepeat /> {label}
          </Button>
        </>
      )}
    </>
  );
};

export default RefreshSnapshotButton;
