import { Flex, Tooltip } from "@radix-ui/themes";
import { ExperimentDataForStatusStringDates } from "shared/types/experiment";
import { StatusIndicatorData } from "shared/enterprise";
import Badge from "@/ui/Badge";
import { useExperimentStatusIndicator } from "@/hooks/useExperimentStatusIndicator";

type LabelFormat = "full" | "status-only" | "detail-only";

export default function ExperimentStatusIndicator({
  experimentData,
  labelFormat = "full",
  skipArchived = false,
  neutralDraft = false,
}: {
  experimentData: ExperimentDataForStatusStringDates;
  labelFormat?: LabelFormat;
  skipArchived?: boolean;
  // Render the Draft status in the design system's neutral grey (Badge
  // gray/soft) instead of its status colour. Optional and additive: callers
  // that pass nothing are unchanged. Used by the redesigned experiment
  // page's header.
  neutralDraft?: boolean;
}) {
  const getExperimentStatusIndicator = useExperimentStatusIndicator();
  const statusIndicatorData = getExperimentStatusIndicator(
    experimentData,
    skipArchived,
  );

  return (
    <RawExperimentStatusIndicator
      statusIndicatorData={statusIndicatorData}
      labelFormat={labelFormat}
      experimentData={experimentData}
      neutralDraft={neutralDraft}
    />
  );
}

// size: optional, in px (8 by default); the experiments list's Health column
// uses 6 (set in review).
export function ExperimentDot({
  color,
  size = 8,
}: {
  color: StatusIndicatorData["color"] | "yellow" | "lime";
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: `var(--${color}-9)`,
      }}
    ></div>
  );
}

export function ExperimentStatusDetailsWithDot({
  statusIndicatorData,
  dotSize,
  dotGap = "1",
}: {
  statusIndicatorData: StatusIndicatorData;
  dotSize?: number;
  // The space between the dot and its label: 4px by default; the
  // experiments list's Health column uses "2", 8px (set in review).
  dotGap?: "1" | "2";
}) {
  const { color, status, detailedStatus, needsAttention, tooltip } =
    statusIndicatorData;

  if (!detailedStatus) return null;

  const contents =
    needsAttention || status === "Stopped" ? (
      <Flex gap={dotGap} align="center">
        <ExperimentDot color={color} size={dotSize} />
        {detailedStatus}
      </Flex>
    ) : (
      <div>{detailedStatus}</div>
    );

  return tooltip ? <Tooltip content={tooltip}>{contents}</Tooltip> : contents;
}

export function RawExperimentStatusIndicator({
  statusIndicatorData,
  labelFormat = "full",
  experimentData,
  neutralDraft = false,
}: {
  statusIndicatorData: StatusIndicatorData;
  labelFormat?: LabelFormat;
  experimentData: ExperimentDataForStatusStringDates;
  neutralDraft?: boolean;
}) {
  const { color, status, detailedStatus, tooltip } = statusIndicatorData;
  const isHoldout = experimentData.type === "holdout";
  const label = getFormattedLabel(
    isHoldout ? "status-only" : labelFormat,
    status,
    detailedStatus,
  );
  const isInAnalysisPeriod =
    isHoldout &&
    experimentData.phases.length > 1 &&
    experimentData.status === "running" &&
    !experimentData.archived;

  const neutral = neutralDraft && status === "Draft";

  const badge = (
    <Badge
      color={neutral ? "gray" : color}
      variant={neutral ? "soft" : "solid"}
      radius="full"
      label={`${label}${isInAnalysisPeriod ? ": Analysis Phase" : ""}`}
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
  detailedStatus?: string,
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
