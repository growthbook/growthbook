import { Box } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
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
}) {
  return (
    <SetupFieldRow
      label="Activation metric"
      tooltip="Users must convert on this metric before being included. Only proportion metrics from this Data Source are listed, not funnels."
    >
      <Tooltip
        content="Activation metrics are not yet supported with Incremental Refresh."
        enabled={incrementalRefresh}
      >
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
            disabled={disabled || incrementalRefresh}
          />
        </Box>
      </Tooltip>
      {incrementalRefresh && value !== "" && !disabled ? (
        <Callout status="warning" mb="2">
          Activation metrics are not yet supported with Incremental Refresh.
          Please{" "}
          <Link style={{ display: "inline" }} onClick={() => onChange("")}>
            click to remove it
          </Link>
          .
        </Callout>
      ) : null}
    </SetupFieldRow>
  );
}
