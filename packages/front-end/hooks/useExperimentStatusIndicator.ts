import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  getHealthSettings,
  getExperimentResultStatus,
  PRESET_DECISION_CRITERIA,
  PRESET_DECISION_CRITERIAS,
  getStatusIndicatorData,
  StatusIndicatorData,
} from "shared/enterprise";
import {
  DecisionCriteriaData,
  DecisionCriteriaInterface,
  ExperimentDataForStatusStringDates,
  ExperimentHealthSettings,
} from "shared/types/experiment";
import { MetricGroupInterface } from "shared/types/metric-groups";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { useDefinitions } from "@/services/DefinitionsContext";

function getExperimentDecisionCriteria({
  orgCustomDecisionCriterias,
  experimentDecisionCriteriaId,
  defaultDecisionCriteriaId,
}: {
  orgCustomDecisionCriterias: DecisionCriteriaInterface[];
  experimentDecisionCriteriaId?: string;
  defaultDecisionCriteriaId?: string;
}): DecisionCriteriaData {
  // If the experiment has a decision criteria id, use that. Otherwise, use the org's default
  const decisionCriteriaToGet =
    experimentDecisionCriteriaId ?? defaultDecisionCriteriaId;

  // return default if no decision criteria id is provided
  if (!decisionCriteriaToGet) {
    return PRESET_DECISION_CRITERIA;
  }

  const presetDecisionCriteria = PRESET_DECISION_CRITERIAS.find(
    (dc) => dc.id === decisionCriteriaToGet,
  );
  // if decision criteria is one of the presets, use that
  if (presetDecisionCriteria) {
    return presetDecisionCriteria;
  }

  // if the decision criteria is a custom one, use that
  const customDecisionCriteria = orgCustomDecisionCriterias.find(
    (dc) => dc.id === decisionCriteriaToGet,
  );
  if (customDecisionCriteria) {
    return customDecisionCriteria;
  }

  // Always fall back to main preset
  return PRESET_DECISION_CRITERIA;
}

export function useRunningExperimentStatus() {
  const { hasCommercialFeature } = useUser();
  const { decisionCriteria, metricGroups } = useDefinitions();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework"),
  );

  return {
    getDecisionCriteria: (experimentDecisionCriteriaId?: string) =>
      getExperimentDecisionCriteria({
        orgCustomDecisionCriterias: decisionCriteria,
        experimentDecisionCriteriaId,
        defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
      }),
    getRunningExperimentResultStatus: (
      experimentData: ExperimentDataForStatusStringDates,
    ) =>
      getRunningExperimentResultStatus({
        experimentData,
        healthSettings,
        metricGroups,
        decisionCriteria: getExperimentDecisionCriteria({
          orgCustomDecisionCriterias: decisionCriteria,
          experimentDecisionCriteriaId:
            experimentData.decisionFrameworkSettings?.decisionCriteriaId,
          defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
        }),
      }),
  };
}

export function useExperimentStatusIndicator() {
  const { hasCommercialFeature } = useUser();
  const { decisionCriteria, metricGroups, getExperimentMetricById } =
    useDefinitions();
  const settings = useOrgSettings();
  const healthSettings = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework"),
  );

  return (
    experimentData: ExperimentDataForStatusStringDates,
    skipArchived: boolean = false,
  ) =>
    getStatusIndicatorData({
      experimentData,
      skipArchived,
      healthSettings,
      decisionCriteria: getExperimentDecisionCriteria({
        orgCustomDecisionCriterias: decisionCriteria,
        experimentDecisionCriteriaId:
          experimentData.decisionFrameworkSettings?.decisionCriteriaId,
        defaultDecisionCriteriaId: settings?.defaultDecisionCriteriaId,
      }),
      metricGroups,
      resolveMetricName: (metricId) =>
        getExperimentMetricById(metricId)?.name ?? metricId,
    });
}

function getRunningExperimentResultStatus({
  experimentData,
  healthSettings,
  decisionCriteria,
  metricGroups,
}: {
  experimentData: ExperimentDataForStatusStringDates;
  healthSettings: ExperimentHealthSettings;
  decisionCriteria: DecisionCriteriaData;
  metricGroups: MetricGroupInterface[];
}) {
  if (experimentData.status !== "running") {
    return undefined;
  }
  return getExperimentResultStatus({
    experimentData,
    healthSettings,
    decisionCriteria,
    metricGroups,
  });
}

// The status indicator's data stays English: code compares its `status` and
// `detailedStatus`, and the API returns them. These are what it shows.
export type StatusIndicatorText = {
  status: string;
  detailedStatus?: string;
  tooltip?: string;
};

const STATUS_LABELS: Record<StatusIndicatorData["status"], MessageDescriptor> =
  {
    Running: msg`Running`,
    Stopped: msg`Stopped`,
    Draft: msg`Draft`,
    Scheduled: msg`Scheduled`,
    Archived: msg`Archived`,
  };

const DETAILED_STATUS_LABELS: Record<string, MessageDescriptor> = {
  Won: msg`Won`,
  Lost: msg`Lost`,
  Inconclusive: msg`Inconclusive`,
  "Didn't finish": msg`Didn't finish`,
  "Awaiting decision": msg`Awaiting decision`,
  "Roll back now": msg`Roll back now`,
  "Ship now": msg`Ship now`,
  "Ready for review": msg`Ready for review`,
  "No data": msg`No data`,
  "Data incomplete": msg`Data incomplete`,
  Unhealthy: msg`Unhealthy`,
};

// The health issues an unhealthy tooltip lists, joined with ", ".
const UNHEALTHY_LABELS: Record<string, MessageDescriptor> = {
  SRM: msg`SRM`,
  "Multiple exposures": msg`Multiple exposures`,
  "Subunit multiple exposures": msg`Subunit multiple exposures`,
  "Low powered": msg`Low powered`,
  "Pre-exposure bias": msg`Pre-exposure bias`,
  "Mixed cluster assignment": msg`Mixed cluster assignment`,
  "Units in multiple clusters": msg`Units in multiple clusters`,
};

const NO_DATA_TOOLTIPS: Record<string, MessageDescriptor> = {
  "No data source configured for experiment": msg`No data source configured for experiment`,
  "No data source configured for holdout": msg`No data source configured for holdout`,
  "No metrics configured for experiment yet": msg`No metrics configured for experiment yet`,
  "No metrics configured for holdout yet": msg`No metrics configured for holdout yet`,
};

// Why a run past its scheduled end has no recommendation, as the English
// tooltip says it, and the whole tooltip for each.
const SCHEDULED_END_REVIEW_TOOLTIPS: [string, MessageDescriptor][] = [
  [
    "No goal metrics are configured",
    msg`The scheduled end date has passed and this experiment is still running. No goal metrics are configured, so no recommendation can be made. Review the results and decide whether to ship a variation, roll back, or keep running.`,
  ],
  [
    "Results are not available yet",
    msg`The scheduled end date has passed and this experiment is still running. Results are not available yet. Review the results and decide whether to ship a variation, roll back, or keep running.`,
  ],
  [
    "The Experiment Decision Framework is not enabled",
    msg`The scheduled end date has passed and this experiment is still running. The Experiment Decision Framework is not enabled, so no recommendation can be made. Review the results and decide whether to ship a variation, roll back, or keep running.`,
  ],
  [
    "No decision criteria were met",
    msg`The scheduled end date has passed and this experiment is still running. No decision criteria were met. Review the results and decide whether to ship a variation, roll back, or keep running.`,
  ],
];

function daysLeftLabel(daysLeft: number, i18n: I18n): string {
  const capped = Math.min(daysLeft, 90);
  // English reads "days" for one day too.
  return daysLeft !== capped
    ? i18n._(
        msg`${plural(capped, { one: "># days left", other: "># days left" })}`,
      )
    : i18n._(
        msg`${plural(capped, { one: "# days left", other: "# days left" })}`,
      );
}

function statusTooltip(
  data: StatusIndicatorData,
  i18n: I18n,
  {
    minLengthDays,
    resolveMetricName,
  }: {
    minLengthDays: number;
    resolveMetricName: (metricId: string) => string;
  },
): string | undefined {
  const result = data.resultStatus;
  if (!result) {
    if (data.status === "Stopped" && data.detailedStatus === "Lost") {
      return i18n._(
        msg`There are no real losers in A/B testing, only learnings.`,
      );
    }
    return data.tooltip;
  }
  switch (result.status) {
    case "rollback-now":
      return result.scheduledEndPassed && !result.powerReached
        ? i18n._(
            msg`The test variation(s) should be rolled back. The scheduled end date has passed and a recommendation can be made.`,
          )
        : i18n._(msg`The test variation(s) should be rolled back.`);
    case "ship-now":
      return result.scheduledEndPassed && !result.powerReached
        ? i18n._(
            msg`A test variation is ready to ship. The scheduled end date has passed and a recommendation can be made.`,
          )
        : i18n._(msg`A test variation is ready to ship.`);
    case "ready-for-review":
      return result.scheduledEndPassed && !result.powerReached
        ? i18n._(
            msg`A test variation is ready to be reviewed. The scheduled end date has passed and there is no clear ship or rollback recommendation.`,
          )
        : i18n._(msg`A test variation is ready to be reviewed.`);
    case "scheduled-end-review": {
      const tooltip = result.tooltip;
      const match = tooltip
        ? SCHEDULED_END_REVIEW_TOOLTIPS.find(([reason]) =>
            tooltip.includes(reason),
          )
        : undefined;
      return match ? i18n._(match[1]) : data.tooltip;
    }
    case "no-data": {
      const message = data.tooltip ? NO_DATA_TOOLTIPS[data.tooltip] : null;
      return message ? i18n._(message) : data.tooltip;
    }
    case "data-incomplete": {
      const names = result.erroredMetrics.map(resolveMetricName);
      if (!names.length) {
        return i18n._(
          msg`Some metrics could not be computed, so ship and review recommendations are paused. Roll back recommendations still apply.`,
        );
      }
      const subject = names.join(", ");
      return i18n._(
        msg`${subject} could not be computed, so ship and review recommendations are paused. Roll back recommendations still apply.`,
      );
    }
    case "unhealthy":
      return result.tooltip
        ?.split(", ")
        .map((issue) => {
          const label = UNHEALTHY_LABELS[issue];
          return label ? i18n._(label) : issue;
        })
        .join(", ");
    case "days-left": {
      const daysLeft = result.daysLeft;
      // A scheduled end sets its own tooltip; the power estimate has none.
      return result.tooltip
        ? i18n._(
            msg`${plural(daysLeft, {
              one: "This experiment is scheduled to end in about # day.",
              other: "This experiment is scheduled to end in about # days.",
            })}`,
          )
        : i18n._(
            msg`The experiment needs more data to reliably detect the target minimum detectable effect for all goal metrics. At recent traffic levels, the experiment will take ~${daysLeft} more days to collect enough data.`,
          );
    }
    case "before-min-duration":
      return i18n._(
        msg`Estimated days left or decision recommendations will appear after the minimum experiment duration of ${minLengthDays} is reached.`,
      );
    default:
      return data.tooltip;
  }
}

export function statusIndicatorText(
  data: StatusIndicatorData,
  i18n: I18n,
  context: {
    minLengthDays: number;
    resolveMetricName: (metricId: string) => string;
  },
): StatusIndicatorText {
  const detailed = data.detailedStatus;
  const detailedLabel = detailed ? DETAILED_STATUS_LABELS[detailed] : null;
  return {
    status: i18n._(STATUS_LABELS[data.status]),
    detailedStatus:
      data.resultStatus?.status === "days-left"
        ? daysLeftLabel(data.resultStatus.daysLeft, i18n)
        : detailedLabel
          ? i18n._(detailedLabel)
          : detailed,
    tooltip: statusTooltip(data, i18n, context),
  };
}

/** Turns a status indicator into the text it shows, translated. */
export function useStatusIndicatorText() {
  const { i18n } = useLingui();
  const { hasCommercialFeature } = useUser();
  const { getExperimentMetricById } = useDefinitions();
  const settings = useOrgSettings();
  const { experimentMinLengthDays } = getHealthSettings(
    settings,
    hasCommercialFeature("decision-framework"),
  );
  return (data: StatusIndicatorData) =>
    statusIndicatorText(data, i18n, {
      minLengthDays: experimentMinLengthDays,
      resolveMetricName: (metricId) =>
        getExperimentMetricById(metricId)?.name ?? metricId,
    });
}
