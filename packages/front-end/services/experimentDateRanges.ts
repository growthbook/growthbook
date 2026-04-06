import { date, daysBetween } from "shared/dates";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";

export type DateRange = {
  startDate: string | Date;
  endDate?: string | Date;
};

type PhaseDateRangeOptions = {
  phase?: ExperimentPhaseStringDates;
  isHoldout?: boolean;
  holdoutAnalysisStartDate?: string | Date;
};

export function getPhaseStartDateForDisplay({
  phase,
  isHoldout,
  holdoutAnalysisStartDate,
}: PhaseDateRangeOptions): string | Date | undefined {
  if (!phase) return undefined;

  if (isHoldout && phase.lookbackStartDate) {
    return holdoutAnalysisStartDate ?? phase.lookbackStartDate;
  }

  return phase.dateStarted;
}

export function getPhaseDateRangeForDisplay({
  phase,
  isHoldout,
  holdoutAnalysisStartDate,
}: PhaseDateRangeOptions): DateRange | null {
  const startDate = getPhaseStartDateForDisplay({
    phase,
    isHoldout,
    holdoutAnalysisStartDate,
  });
  if (!startDate) return null;

  return {
    startDate,
    endDate: phase?.dateEnded,
  };
}

export function formatDateRangeForDisplay(
  range: DateRange,
  {
    delimiter = " - ",
    inTimezone,
  }: {
    delimiter?: string;
    inTimezone?: string;
  } = {},
): string {
  return `${date(range.startDate, inTimezone)}${delimiter}${
    range.endDate ? date(range.endDate, inTimezone) : "now"
  }`;
}

export function getRuntimeRangeForSelectedPhase({
  experiment,
  selectedPhase,
  holdoutAnalysisStartDate,
}: {
  experiment: ExperimentInterfaceStringDates;
  selectedPhase?: number;
  holdoutAnalysisStartDate?: string;
}): DateRange | null {
  // Draft experiments have planned phase dates, but runtime should only be shown
  // once an experiment has actually started.
  if (experiment.status === "draft") return null;

  const phases = experiment.phases ?? [];
  if (!phases.length) return null;

  const normalizedPhase = Math.max(
    0,
    Math.min(selectedPhase ?? phases.length - 1, phases.length - 1),
  );

  const selectedRange = getPhaseDateRangeForDisplay({
    phase: phases[normalizedPhase],
    isHoldout: experiment.type === "holdout",
    holdoutAnalysisStartDate,
  });
  return selectedRange;
}

export function getTotalRuntimeRange({
  experiment,
  holdoutAnalysisStartDate,
}: {
  experiment: ExperimentInterfaceStringDates;
  holdoutAnalysisStartDate?: string;
}): DateRange | null {
  if (experiment.status === "draft") return null;

  const phaseRanges = (experiment.phases ?? [])
    .map((phase) =>
      getPhaseDateRangeForDisplay({
        phase,
        isHoldout: experiment.type === "holdout",
        holdoutAnalysisStartDate,
      }),
    )
    .filter((range): range is DateRange => !!range);

  if (!phaseRanges.length) return null;

  const firstRange = phaseRanges[0];
  const lastRange = phaseRanges[phaseRanges.length - 1];

  return {
    startDate: firstRange.startDate,
    endDate: lastRange.endDate,
  };
}

export function getDateRangeDurationInDays(range: DateRange): number {
  return daysBetween(range.startDate, range.endDate ?? new Date().toISOString());
}
