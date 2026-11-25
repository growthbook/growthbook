import { Box } from "@radix-ui/themes";
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  ExperimentInterfaceStringDates,
  ExperimentResultStatusData,
} from "shared/types/experiment";
import { date } from "shared/dates";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiClockFill, PiWarningCircleBold } from "react-icons/pi";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { Reason } from "./ExperimentDecisionExplanation";
import ExperimentBanner from "./ExperimentBanner";

type Props = {
  experiment: ExperimentInterfaceStringDates;
  runningExperimentStatus?: ExperimentResultStatusData;
  editSchedule?: () => void;
} & MarginProps;

type DecisiveStatus = "ship-now" | "rollback-now" | "ready-for-review";

type NonDecisiveStatusData = Exclude<
  ExperimentResultStatusData,
  { status: DecisiveStatus }
>;

function getReasonText(statusData: NonDecisiveStatusData, i18n: I18n): string {
  switch (statusData.status) {
    case "unhealthy": {
      const tooltip = statusData.tooltip;
      return tooltip
        ? i18n._(msg`Results are unhealthy (${tooltip}).`)
        : i18n._(msg`Results are unhealthy.`);
    }
    case "no-data":
      return statusData.tooltip
        ? `${statusData.tooltip}.`
        : i18n._(msg`There is no data yet.`);
    case "data-incomplete":
      return i18n._(
        msg`One or more goal or guardrail metrics could not be computed, so no decision recommendation is available.`,
      );
    case "scheduled-end-review":
      return (
        statusData.tooltip ??
        i18n._(msg`No decision recommendation is available.`)
      );
    case "days-left": {
      if (statusData.tooltip) return statusData.tooltip;
      const daysLeft = statusData.daysLeft;
      return daysLeft === 1
        ? i18n._(
            msg`More data is needed — about ${daysLeft} more day to reach the targeted statistical power.`,
          )
        : i18n._(
            msg`More data is needed — about ${daysLeft} more days to reach the targeted statistical power.`,
          );
    }
    case "before-min-duration":
      return i18n._(
        msg`The minimum experiment duration has not been reached yet.`,
      );
    default:
      return i18n._(msg`No decision recommendation is available.`);
  }
}

export default function ScheduledEndPassedBanner({
  experiment,
  runningExperimentStatus,
  editSchedule,
  ...margin
}: Props) {
  const { i18n } = useLingui();
  const stopAt = experiment.statusUpdateSchedule?.stopAt;
  const scheduledEndPassed =
    experiment.status === "running" &&
    !!stopAt &&
    new Date(stopAt) <= new Date();

  // Decisive statuses are covered by RunningExperimentDecisionBanner.
  const status = runningExperimentStatus?.status;
  const hasDecision =
    status === "ship-now" ||
    status === "rollback-now" ||
    status === "ready-for-review";

  if (!scheduledEndPassed || !runningExperimentStatus || hasDecision) {
    return null;
  }

  const endDate = date(stopAt);

  return (
    <ExperimentBanner
      headline={
        <>
          <PiClockFill
            size={16}
            style={{ color: "var(--amber-11)", flexShrink: 0 }}
          />
          <Text color="text-mid">
            <Trans>Past its scheduled end, {endDate}</Trans>
          </Text>
          <Text color="text-low">·</Text>
          <Text color="text-low">
            <Trans>No clear recommendation</Trans>
          </Text>
        </>
      }
      details={
        <>
          <Text as="div" mb="2">
            <Trans>
              The experiment kept running past its scheduled end, as its
              schedule asks. There&apos;s no clear recommendation because:
            </Trans>
          </Text>
          <Reason color="amber" icon={<PiWarningCircleBold />}>
            {getReasonText(runningExperimentStatus, i18n)}
          </Reason>
          {editSchedule ? (
            <Box mt="3" mb="1">
              <Link onClick={editSchedule}>
                <Trans>Edit schedule</Trans>
              </Link>
            </Box>
          ) : null}
        </>
      }
      {...margin}
    />
  );
}
