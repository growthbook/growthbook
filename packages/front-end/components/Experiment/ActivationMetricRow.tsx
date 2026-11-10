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
  const lockedReason = isClusterExperiment
    ? "Activation metrics aren't supported for cluster experiments."
    : incrementalRefresh
      ? "Activation metrics are not yet supported with Incremental Refresh."
      : null;
  return (
    <SetupFieldRow
      label="Activation metric"
      tooltip="Users must convert on this metric before being included. Only proportion metrics from this Data Source are listed, not funnels."
    >
      <Tooltip content={lockedReason} enabled={!!lockedReason}>
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
            disabled={disabled || !!lockedReason}
          />
        </Box>
      </Tooltip>
      {lockedReason && value !== "" && !disabled ? (
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
          {lockedReason}
        </Callout>
      ) : null}
    </SetupFieldRow>
  );
}
