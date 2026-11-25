import { Flex, Tooltip } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { ExperimentDataForStatusStringDates } from "shared/types/experiment";
import { StatusIndicatorData } from "shared/enterprise";
import Badge from "@/ui/Badge";
import StatusDot from "@/components/Experiment/StatusDot";
import {
  useExperimentStatusIndicator,
  useStatusIndicatorText,
} from "@/hooks/useExperimentStatusIndicator";

type LabelFormat = "full" | "status-only" | "detail-only";

export default function ExperimentStatusIndicator({
  experimentData,
  labelFormat = "full",
  skipArchived = false,
  size,
}: {
  experimentData: ExperimentDataForStatusStringDates;
  labelFormat?: LabelFormat;
  skipArchived?: boolean;
  size?: "xs" | "sm";
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
      size={size}
    />
  );
}

export function ExperimentDot({
  color,
}: {
  color: StatusIndicatorData["color"] | "yellow" | "lime";
}) {
  return <StatusDot color={`var(--${color}-9)`} />;
}

export function ExperimentStatusDetailsWithDot({
  statusIndicatorData,
}: {
  statusIndicatorData: StatusIndicatorData;
}) {
  const statusText = useStatusIndicatorText();
  const { color, status, needsAttention } = statusIndicatorData;
  const { detailedStatus, tooltip } = statusText(statusIndicatorData);

  if (!detailedStatus) return null;

  const contents =
    needsAttention || status === "Stopped" ? (
      <Flex gap="1" align="center">
        <ExperimentDot color={color} />
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
  size,
}: {
  statusIndicatorData: StatusIndicatorData;
  labelFormat?: LabelFormat;
  experimentData: ExperimentDataForStatusStringDates;
  size?: "xs" | "sm";
}) {
  const { t, i18n } = useLingui();
  const statusText = useStatusIndicatorText();
  const { color } = statusIndicatorData;
  const { status, detailedStatus, tooltip } = statusText(statusIndicatorData);
  const isHoldout = experimentData.type === "holdout";
  const label = getFormattedLabel(
    isHoldout ? "status-only" : labelFormat,
    i18n,
    status,
    detailedStatus,
  );
  const isInAnalysisPeriod =
    isHoldout &&
    experimentData.phases.length > 1 &&
    experimentData.status === "running" &&
    !experimentData.archived;

  const badge = (
    <Badge
      color={color}
      variant={"solid"}
      radius="full"
      size={size}
      label={isInAnalysisPeriod ? t`${label}: Analysis Phase` : label}
      style={{
        cursor: tooltip !== undefined ? "default" : undefined,
      }}
    />
  );

  return tooltip ? <Tooltip content={tooltip}>{badge}</Tooltip> : badge;
}

// Takes the status text translated, as useStatusIndicatorText gives it.
export function getFormattedLabel(
  labelFormat: LabelFormat,
  i18n: I18n,
  status: string,
  detailedStatus?: string,
): string {
  switch (labelFormat) {
    case "full":
      if (detailedStatus) {
        return i18n._(msg`${status}: ${detailedStatus}`);
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
