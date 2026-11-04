import { Box } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import MetricSelector from "./MetricSelector";

/** The metric users must convert on before they're counted. */
export default function ActivationMetricRow({
  datasource,
  exposureQueryId,
  exposureQueryIdentifierType,
  project,
  value,
  onChange,
  disabled = false,
  incrementalRefresh = false,
  isClusterExperiment = false,
}: {
  datasource?: string;
  exposureQueryId?: string;
  exposureQueryIdentifierType?: string;
  project?: string;
  value: string;
  onChange: (metric: string) => void;
  disabled?: boolean;
  // Activation metrics can't be used with it, so the selector locks.
  incrementalRefresh?: boolean;
  isClusterExperiment?: boolean;
}) {
  // Reasons the picker is locked, in precedence order. `null` means unlocked.
  const lockReason = incrementalRefresh
    ? "Activation metrics are not yet supported with Incremental Refresh."
    : isClusterExperiment
      ? "Activation metrics aren't supported for cluster experiments."
      : null;

  return (
    <SetupFieldRow
      label="Activation metric"
      tooltip="Users must convert on this metric before being included. Only proportion metrics from this Data Source are listed, not funnels."
    >
      <Tooltip content={lockReason ?? ""} enabled={!!lockReason}>
        <Box>
          <MetricSelector
            datasource={datasource}
            exposureQueryId={exposureQueryId}
            exposureQueryIdentifierType={exposureQueryIdentifierType}
            project={project}
            includeFacts
            initialOption="None"
            onlyBinomial
            filterFactFunnelMetrics
            value={value}
            onChange={onChange}
            disabled={disabled || !!lockReason}
          />
        </Box>
      </Tooltip>
      {lockReason && value !== "" && !disabled ? (
        <Callout
          status="warning"
          contentAlign="center"
          mt="2"
          action={
            <Button variant="outline" size="sm" onClick={() => onChange("")}>
              Remove
            </Button>
          }
        >
          {lockReason}
        </Callout>
      ) : null}
    </SetupFieldRow>
  );
}
