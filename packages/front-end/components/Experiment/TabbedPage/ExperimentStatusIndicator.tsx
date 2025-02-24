import { Tooltip } from "@radix-ui/themes";
import Badge from "@/components/Radix/Badge";
import {
  ExperimentData,
  useExperimentStatusIndicator,
} from "@/hooks/useExperimentStatusIndicator";

type LabelFormat = "full" | "status-only" | "detail-only";

export type StatusIndicatorData = {
  color: React.ComponentProps<typeof Badge>["color"];
  variant: React.ComponentProps<typeof Badge>["variant"];
  status: string;
  detailedStatus?: string;
  tooltip?: string;
};

export default function ExperimentStatusIndicator({
  experimentData,
  labelFormat = "full",
}: {
  experimentData: ExperimentData;
  labelFormat?: LabelFormat;
}) {
  const getExperimentStatusIndicator = useExperimentStatusIndicator();
  const statusIndicatorData = getExperimentStatusIndicator(experimentData);

  return (
    <RawExperimentStatusIndicator
      statusIndicatorData={statusIndicatorData}
      labelFormat={labelFormat}
    />
  );
}

export function RawExperimentStatusIndicator({
  statusIndicatorData,
  labelFormat = "full",
}: {
  statusIndicatorData: StatusIndicatorData;
  labelFormat?: LabelFormat;
}) {
  const {
    color,
    variant,
    status,
    detailedStatus,
    tooltip,
  } = statusIndicatorData;
  const label = getFormattedLabel(labelFormat, status, detailedStatus);

  const badge = (
    <Badge
      color={color}
      variant={variant}
      radius="full"
      label={label}
      style={{
        cursor: tooltip !== undefined ? "default" : undefined,
      }}
    />
  );

  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

function getFormattedLabel(
  labelFormat: LabelFormat,
  status: string,
  detailedStatus?: string
): string {
  switch (labelFormat) {
    case "full":
      if (detailedStatus) {
        return `${status}: ${detailedStatus}`;
      } else {
        return status;
      }

    case "detail-only":
      if (detailedStatus) {
        return detailedStatus;
      } else {
        return status;
      }

    case "status-only":
      return status;

    default: {
      const _exhaustiveCheck: never = labelFormat;
      throw new Error(`Unknown label format: ${_exhaustiveCheck}`);
    }
  }
}
