import { ReactNode } from "react";
import { ExperimentRefRule, FeatureInterface } from "shared/types/feature";
import NextLink from "next/link";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getTempRolloutStaleReason,
  includeExperimentInPayload,
  calculateNamespaceCoverage,
  getConfigBackingKey,
  getFeatureBaseConfigKey,
} from "shared/util";
import { ago } from "shared/dates";
import {
  getLatestPhaseVariations,
  hasTargetingConfigured,
} from "shared/experiments";
import { FaExclamationTriangle } from "react-icons/fa";
import { Box, Flex } from "@radix-ui/themes";
import Link from "@/ui/Link";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import Table, { TableBody, TableRow, TableCell } from "@/ui/Table";
import { coveragePercentFormatter } from "@/services/utils";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";
import ValueDisplay, { LISTED_VALUE_STYLE } from "./ValueDisplay";
import ConfigBackedSummary from "./ConfigBackedSummary";
import { ValueDiffProvider } from "./ValueDiffContext";
import ExperimentSplitVisual from "./ExperimentSplitVisual";
import ConditionDisplay from "./ConditionDisplay";
import { AttributeBadge } from "./AttributeBadge";
import { EntityBadge, PlainEntityBadge } from "./EntityBadge";
import ForceSummary from "./ForceSummary";
import RolloutRow from "./RolloutRow";
import RuleField from "./RuleField";
import variationsTableStyles from "./RuleVariationsTable.module.scss";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function isExperimentRefRuleSkipped(
  experiment: ExperimentInterfaceStringDates,
  isDraft: boolean,
) {
  if (experiment.status === "draft" && !experiment.archived) {
    // Draft experiments are published alongside feature drafts,
    // so don't need to mark this as skipped if we're viewing a feature draft
    return !isDraft;
  }
  return !includeExperimentInPayload(experiment);
}

// Why an experiment rule serves nothing, or null while it serves.
export function experimentRefSkipReason(
  experiment: ExperimentInterfaceStringDates | undefined,
  isDraft: boolean,
): ReactNode {
  if (!experiment) return "The experiment could not be found.";
  const noun =
    experiment.type === "multi-armed-bandit" ? "Bandit" : "experiment";
  const view = <Link href={`/experiment/${experiment.id}`}>View {noun}</Link>;
  if (experiment.archived) {
    return (
      <>
        This {noun} is archived. {view}
      </>
    );
  }
  if (!experiment.phases.length) {
    return (
      <>
        This {noun} is not running. {view}
      </>
    );
  }
  if (
    experiment.status === "stopped" &&
    (experiment.excludeFromPayload || !experiment.releasedVariationId)
  ) {
    return (
      <>
        This {noun} is stopped without a temporary rollout.{" "}
        <Link href={`/experiment/${experiment.id}#results`}>View results</Link>
      </>
    );
  }
  if (experiment.status === "draft" && !isDraft) {
    return (
      <>
        This {noun} is in a <strong>draft</strong> state and has not been
        started yet.
      </>
    );
  }
  return null;
}

export function TempRolloutCallout({
  rule,
  experiment,
}: {
  rule: ExperimentRefRule;
  experiment?: ExperimentInterfaceStringDates;
}) {
  if (!experiment || experiment.status !== "stopped") return null;
  if (rule.enabled === false || !includeExperimentInPayload(experiment)) {
    return null;
  }
  const isBandit = experiment.type === "multi-armed-bandit";
  const lastPhaseEnded =
    experiment.phases?.[experiment.phases.length - 1]?.dateEnded;
  const isOld = getTempRolloutStaleReason(experiment) === "old-temp-rollout";
  return (
    <Callout status={isOld ? "warning" : "info"} size="sm" mb="3">
      Temporary rollout from {isBandit ? "a Bandit" : "an experiment"} that
      stopped {lastPhaseEnded ? ago(lastPhaseEnded) : "earlier"}.{" "}
      {isOld
        ? "Once the winner is in code, stop the rollout on the experiment."
        : "Stop it on the experiment when it is no longer needed."}
    </Callout>
  );
}

export default function ExperimentRefSummary({
  rule,
  experiment,
  feature,
  environment,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRefRule;
  // Environment this rule is shown for, so config-backed arm values preview
  // their matching env flavor. Absent (all-environments view) = base value.
  environment?: string;
}) {
  const { variations } = rule;
  const type = feature.valueType;

  const { namespaces, useStickyBucketing } = useOrgSettings();

  const isBandit = experiment?.type === "multi-armed-bandit";

  // The card's ribbon says why these serve nothing.
  if (!experiment || experiment.archived) return null;
  const phase = experiment.phases[experiment.phases.length - 1];
  if (!phase) return null;

  const releasedValue =
    experiment.status === "stopped" && !experiment.excludeFromPayload
      ? rule.variations.find(
          (v) => v.variationId === experiment.releasedVariationId,
        )
      : null;

  if (experiment.status === "stopped" && !releasedValue) return null;

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && phase.namespace
      ? calculateNamespaceCoverage(phase.namespace)
      : 1;
  const effectiveCoverage = namespaceRange * (phase.coverage ?? 1);

  const hasCondition = hasTargetingConfigured(phase);

  return (
    <Box>
      {hasCondition && (
        <RuleField label="Targeting">
          <ConditionDisplay
            condition={phase.condition}
            savedGroups={phase.savedGroups}
            prerequisites={phase.prerequisites}
          />
        </RuleField>
      )}

      <RuleField label="Split by">
        <Flex align="center" gap="2" wrap="wrap">
          <AttributeBadge attributeId={experiment.hashAttribute || "id"} />
          {hasNamespace && (
            <>
              in the namespace
              <NextLink href={`/namespaces`}>
                <EntityBadge
                  label={
                    <Text color="text-high">
                      {namespaces?.find((n) => n.name === phase.namespace!.name)
                        ?.label || (
                        <span
                          className="italic text-danger"
                          title="this namespace is not found"
                        >
                          <FaExclamationTriangle /> {phase.namespace!.name}
                        </span>
                      )}
                    </Text>
                  }
                />
              </NextLink>
            </>
          )}
        </Flex>
      </RuleField>
      <RolloutRow coverage={effectiveCoverage}>
        {hasNamespace && (
          <>
            {" "}
            (
            <PlainEntityBadge
              label={percentFormatter.format(namespaceRange)}
            />{" "}
            of the namespace and{" "}
            <PlainEntityBadge
              label={coveragePercentFormatter.format(phase?.coverage ?? 1)}
            />{" "}
            exposure)
          </>
        )}
      </RolloutRow>
      {releasedValue ? (
        <ForceSummary
          feature={feature}
          value={releasedValue.value}
          sparse={rule.sparse}
          environment={environment}
        />
      ) : (
        <>
          <RuleField label="Serve" align="start">
            <Box>
              <ValueDiffProvider>
                <Table
                  variant="surface"
                  className={variationsTableStyles.table}
                >
                  <TableBody>
                    {getLatestPhaseVariations(experiment).map(
                      (variation, j) => {
                        const variationEntry = variations.find(
                          (v) => v.variationId === variation.id,
                        );
                        const isMissing = variationEntry === undefined;
                        const value = variationEntry?.value ?? "";

                        const weight = phase.variationWeights?.[j] || 0;

                        return (
                          <TableRow
                            key={j}
                            style={{ color: "var(--color-text-high)" }}
                          >
                            <TableCell style={{ whiteSpace: "nowrap" }}>
                              <Tooltip content={variation.name}>
                                <Box className={variationsTableStyles.marker}>
                                  <VariationNumber number={j} />
                                </Box>
                              </Tooltip>
                            </TableCell>
                            {!isBandit && (
                              <TableCell
                                style={{
                                  color: "var(--color-text-mid)",
                                  textAlign: "right",
                                }}
                              >
                                {percentFormatter.format(weight)}
                              </TableCell>
                            )}
                            <TableCell width="100%">
                              {isMissing ? (
                                <HelperText status="warning">
                                  Define missing values
                                </HelperText>
                              ) : (
                                (() => {
                                  // Config-backed arms render the config's name —
                                  // never the raw `@config:` directive. Only a
                                  // config-backed feature resolves configs.
                                  const baseConfigKey =
                                    getFeatureBaseConfigKey(feature);
                                  const configKey =
                                    baseConfigKey !== null
                                      ? (getConfigBackingKey(value) ??
                                        baseConfigKey)
                                      : null;
                                  if (configKey !== null) {
                                    return (
                                      <ConfigBackedSummary
                                        label={null}
                                        value={value}
                                        configKey={configKey}
                                        feature={feature}
                                        sparse={rule.sparse}
                                        environment={environment}
                                      />
                                    );
                                  }
                                  return (
                                    <>
                                      <ValueDisplay
                                        value={value}
                                        type={type}
                                        fullStyle={LISTED_VALUE_STYLE}
                                        showFullscreenButton={true}
                                        sparse={rule.sparse}
                                        defaultValue={feature.defaultValue}
                                        actionsOverlay={{ inline: true }}
                                      />
                                      <ValidateValue
                                        value={value}
                                        feature={feature}
                                      />
                                    </>
                                  );
                                })()
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      },
                    )}
                  </TableBody>
                </Table>
              </ValueDiffProvider>
            </Box>
            {/* A Bandit sets its own split. */}
            {!isBandit && (
              <Box mt="3">
                <ExperimentSplitVisual
                  values={getLatestPhaseVariations(experiment).map(
                    (variation, j) => {
                      return {
                        name: variation.name,
                        value:
                          variations.find((v) => v.variationId === variation.id)
                            ?.value ?? "",
                        weight: phase.variationWeights?.[j] || 0,
                      };
                    },
                  )}
                  coverage={effectiveCoverage}
                  condensed
                  label="Traffic split"
                  unallocated="Not included (skips this rule)"
                  type={type}
                  showValues={false}
                  stackLeft={true}
                  showPercentages={true}
                />
              </Box>
            )}

            {useStickyBucketing ? (
              <Text as="div" mt="2">
                Sticky Bucketing{" "}
                {experiment.disableStickyBucketing ? "disabled" : "enabled"}
              </Text>
            ) : null}
          </RuleField>

          <RuleField label="Tracking key" mb="0">
            <PlainEntityBadge label={experiment.trackingKey} />
          </RuleField>
        </>
      )}
    </Box>
  );
}
