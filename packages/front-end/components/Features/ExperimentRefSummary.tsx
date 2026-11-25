import { ReactNode } from "react";
import { ExperimentRefRule, FeatureInterface } from "shared/types/feature";
import NextLink from "next/link";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  experimentHasLinkedChanges,
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
import { PiWarningFill } from "react-icons/pi";
import { Box, Flex } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import Link from "@/ui/Link";
import ValidateValue from "@/components/Features/ValidateValue";
import useOrgSettings from "@/hooks/useOrgSettings";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import { coveragePercentFormatter } from "@/services/utils";
import Tooltip from "@/ui/Tooltip";
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
import RuleVariationsTable from "./RuleVariationsTable";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export function isExperimentRefRuleSkipped(
  experiment: ExperimentInterfaceStringDates,
) {
  // A draft's rule is left out of SDK payloads until it starts, unless a
  // connection includes draft experiment rules.
  if (experiment.status === "draft" && !experiment.archived) return true;
  return !includeExperimentInPayload(experiment);
}

// Why an experiment rule serves nothing, or null while it serves.
export function experimentRefSkipReason(
  experiment: ExperimentInterfaceStringDates | undefined,
): ReactNode {
  if (!experiment) return <Trans>The experiment could not be found.</Trans>;
  const isBandit = experiment.type === "multi-armed-bandit";
  const href = `/${isBandit ? "bandit" : "experiment"}/${experiment.id}`;
  const view = (
    <Link href={href}>
      {isBandit ? <Trans>View Bandit</Trans> : <Trans>View experiment</Trans>}
    </Link>
  );
  if (experiment.archived) {
    return isBandit ? (
      <Trans>This Bandit is archived. {view}</Trans>
    ) : (
      <Trans>This experiment is archived. {view}</Trans>
    );
  }
  if (!experimentHasLinkedChanges(experiment)) {
    return isBandit ? (
      <Trans>This Bandit has no linked changes. {view}</Trans>
    ) : (
      <Trans>This experiment has no linked changes. {view}</Trans>
    );
  }
  if (!experiment.phases.length) {
    return isBandit ? (
      <Trans>This Bandit is not running. {view}</Trans>
    ) : (
      <Trans>This experiment is not running. {view}</Trans>
    );
  }
  if (
    experiment.status === "stopped" &&
    (experiment.excludeFromPayload || !experiment.releasedVariationId)
  ) {
    const resultsHref = `${href}#results`;
    return isBandit ? (
      <Trans>
        This Bandit is stopped without a temporary rollout.{" "}
        <Link href={resultsHref}>View results</Link>
      </Trans>
    ) : (
      <Trans>
        This experiment is stopped without a temporary rollout.{" "}
        <Link href={resultsHref}>View results</Link>
      </Trans>
    );
  }
  if (experiment.status === "draft") {
    return isBandit ? (
      <Trans>
        This Bandit does not serve while in draft unless the SDK connection opts
        in.
      </Trans>
    ) : (
      <Trans>
        This experiment does not serve while in draft unless the SDK connection
        opts in.
      </Trans>
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
  const stoppedAgo = lastPhaseEnded ? ago(lastPhaseEnded) : null;
  return (
    <Callout status={isOld ? "warning" : "info"} size="sm" mb="3">
      {isBandit ? (
        stoppedAgo !== null ? (
          <Trans>
            Temporary rollout from a Bandit that stopped {stoppedAgo}.
          </Trans>
        ) : (
          <Trans>Temporary rollout from a Bandit that stopped earlier.</Trans>
        )
      ) : stoppedAgo !== null ? (
        <Trans>
          Temporary rollout from an experiment that stopped {stoppedAgo}.
        </Trans>
      ) : (
        <Trans>
          Temporary rollout from an experiment that stopped earlier.
        </Trans>
      )}{" "}
      {isOld ? (
        <Trans>
          Once the winner is in code, stop the rollout on the experiment.
        </Trans>
      ) : (
        <Trans>Stop it on the experiment when it is no longer needed.</Trans>
      )}
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
  const { t } = useLingui();
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

  if (experiment.status === "stopped" && !releasedValue) {
    const resultsHref = `/experiment/${experiment.id}#results`;
    // The ribbon covers a stop without a rollout; this rule just predates the
    // variation that was released.
    if (experiment.excludeFromPayload || !experiment.releasedVariationId) {
      return null;
    }
    return (
      <Callout status="warning">
        <Trans>
          This rule has no value for the released variation.{" "}
          <Link href={resultsHref}>View results</Link>
        </Trans>
      </Callout>
    );
  }

  const hasNamespace = phase.namespace && phase.namespace.enabled;
  // Calculate total namespace allocation
  const namespaceRange =
    hasNamespace && phase.namespace
      ? calculateNamespaceCoverage(phase.namespace)
      : 1;
  const effectiveCoverage = namespaceRange * (phase.coverage ?? 1);

  const hasCondition = hasTargetingConfigured(phase);
  const namespacePercent = percentFormatter.format(namespaceRange);
  const exposurePercent = coveragePercentFormatter.format(phase?.coverage ?? 1);

  return (
    <Box>
      {hasCondition && (
        <RuleField label={t`Targeting`}>
          <ConditionDisplay
            condition={phase.condition}
            savedGroups={phase.savedGroups}
            prerequisites={phase.prerequisites}
          />
        </RuleField>
      )}

      <RuleField label={t`Split by`}>
        <Flex align="center" gap="2" wrap="wrap">
          <AttributeBadge attributeId={experiment.hashAttribute || "id"} />
          {hasNamespace && (
            <>
              <Trans>in the namespace</Trans>
              <NextLink href={`/namespaces`}>
                <EntityBadge
                  label={
                    <Text color="text-high">
                      {namespaces?.find((n) => n.name === phase.namespace!.name)
                        ?.label || (
                        <Tooltip content={t`This namespace was not found`}>
                          <span
                            tabIndex={0}
                            style={{
                              color: "var(--red-11)",
                              fontStyle: "italic",
                            }}
                          >
                            <PiWarningFill /> {phase.namespace!.name}
                          </span>
                        </Tooltip>
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
            <Trans>
              (<PlainEntityBadge label={namespacePercent} /> of the namespace
              and <PlainEntityBadge label={exposurePercent} /> exposure)
            </Trans>
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
          <RuleField label={t`Serve`} align="start">
            <Box>
              <ValueDiffProvider>
                <RuleVariationsTable
                  rows={getLatestPhaseVariations(experiment).map(
                    (variation, j) => {
                      const variationEntry = variations.find(
                        (v) => v.variationId === variation.id,
                      );
                      return {
                        key: variation.id,
                        name: variation.name,
                        // A Bandit sets its own split.
                        weight: isBandit
                          ? undefined
                          : phase.variationWeights?.[j] || 0,
                        value:
                          variationEntry === undefined ? (
                            <HelperText status="warning">
                              <Trans>Define missing values</Trans>
                            </HelperText>
                          ) : (
                            <ExperimentRefVariationValue
                              value={variationEntry.value}
                              feature={feature}
                              sparse={rule.sparse}
                              environment={environment}
                            />
                          ),
                      };
                    },
                  )}
                />
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
                  label={t`Traffic split`}
                  unallocated={t`Not included (skips this rule)`}
                  type={type}
                  showValues={false}
                  stackLeft={true}
                  showPercentages={true}
                />
              </Box>
            )}

            {useStickyBucketing ? (
              <Text as="div" mt="2">
                {experiment.disableStickyBucketing ? (
                  <Trans>Sticky Bucketing disabled</Trans>
                ) : (
                  <Trans>Sticky Bucketing enabled</Trans>
                )}
              </Text>
            ) : null}
          </RuleField>

          <RuleField label={t`Tracking key`} mb="0">
            <PlainEntityBadge label={experiment.trackingKey} />
          </RuleField>
        </>
      )}
    </Box>
  );
}

// An arm's value. Config-backed arms show the config's name, never the raw
// `@config:` directive; only a config-backed feature resolves configs.
function ExperimentRefVariationValue({
  value,
  feature,
  sparse,
  environment,
}: {
  value: string;
  feature: FeatureInterface;
  sparse?: boolean;
  environment?: string;
}) {
  const baseConfigKey = getFeatureBaseConfigKey(feature);
  const configKey =
    baseConfigKey !== null
      ? (getConfigBackingKey(value) ?? baseConfigKey)
      : null;
  if (configKey !== null) {
    return (
      <ConfigBackedSummary
        label={null}
        value={value}
        configKey={configKey}
        feature={feature}
        sparse={sparse}
        environment={environment}
      />
    );
  }
  return (
    <>
      <ValueDisplay
        value={value}
        type={feature.valueType}
        fullStyle={LISTED_VALUE_STYLE}
        showFullscreenButton={true}
        sparse={sparse}
        defaultValue={feature.defaultValue}
        actionsOverlay={{ inline: true }}
      />
      <ValidateValue value={value} feature={feature} />
    </>
  );
}
