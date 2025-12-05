import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, ReactElement, useState } from "react";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature } from "shared/util";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { RiAlertLine, RiDraggable } from "react-icons/ri";
import { RxCircleBackslash } from "react-icons/rx";
import { PiArrowBendRightDown } from "react-icons/pi";
import { format as formatTimeZone } from "date-fns-tz";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { HoldoutInterface } from "shared/src/validators/holdout";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import {
  getRules,
  isRuleInactive,
  useEnvironments,
  useAttributeMap,
  getAttributesWithVersionStringMismatches,
} from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/ui/HelperText";
import Badge from "@/ui/Badge";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/ui/Callout";
import SafeRolloutSummary from "@/components/Features/SafeRolloutSummary";
import SafeRolloutSnapshotProvider from "@/components/SafeRollout/SnapshotProvider";
import SafeRolloutDetails from "@/components/SafeRollout/SafeRolloutDetails";
import SafeRolloutStatusModal from "@/components/Features/SafeRollout/SafeRolloutStatusModal";
import SafeRolloutStatusBadge from "@/components/SafeRollout/SafeRolloutStatusBadge";
import DecisionCTA from "@/components/SafeRollout/DecisionCTA";
import DecisionHelpText from "@/components/SafeRollout/DecisionHelpText";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import ExperimentSummary from "./ExperimentSummary";
import ExperimentRefSummary, {
  isExperimentRefRuleSkipped,
} from "./ExperimentRefSummary";

interface SortableProps {
  i: number;
  rule: FeatureRule;
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (args: {
    environment: string;
    i: number;
    defaultType?: string;
    mode: "create" | "edit" | "duplicate";
  }) => void;
  setCopyRuleModal: (args: {
    environment: string;
    rules: FeatureRule[];
  }) => void;
  unreachable?: boolean;
  version: number;
  setVersion: (version: number) => void;
  locked: boolean;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  hideInactive?: boolean;
  isDraft: boolean;
  holdout: HoldoutInterface | undefined;
}

type RuleProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

function isRuleSkipped({
  rule,
  linkedExperiment,
  isDraft,
}: {
  rule: FeatureRule;
  isDraft: boolean;
  linkedExperiment?: ExperimentInterfaceStringDates;
}): boolean {
  // Not live yet
  const upcomingScheduleRule = getUpcomingScheduleRule(rule);
  if (upcomingScheduleRule?.enabled && rule?.scheduleRules?.length) return true;

  // Schedule completed and disabled
  if (
    !upcomingScheduleRule &&
    rule?.scheduleRules?.length &&
    rule.scheduleRules.at(-1)?.timestamp !== null
  ) {
    return true;
  }

  // If the experiment is skipped
  if (
    linkedExperiment &&
    isExperimentRefRuleSkipped(linkedExperiment, isDraft)
  ) {
    return true;
  }

  return false;
}

// eslint-disable-next-line
export const Rule = forwardRef<HTMLDivElement, RuleProps>(
  (
    {
      i,
      rule,
      feature,
      environment,
      setRuleModal,
      setCopyRuleModal,
      mutate,
      handle,
      unreachable,
      version,
      setVersion,
      locked,
      experimentsMap,
      safeRolloutsMap,
      hideInactive,
      isDraft,
      holdout,
      ...props
    },
    ref,
  ) => {
    const { apiCall } = useAuth();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const [safeRolloutStatusModalOpen, setSafeRolloutStatusModalOpen] =
      useState(false);

    const attributeMap = useAttributeMap(feature.project);
    const attributesWithVersionStringOperatorMismatches =
      getAttributesWithVersionStringMismatches(
        rule.condition || "",
        attributeMap,
      );

    let title: string | ReactElement =
      rule.description || rule.type[0].toUpperCase() + rule.type.slice(1);
    if (rule.type !== "rollout") {
      title += " Rule";
    }
    if (rule.type === "experiment") {
      title = (
        <div className="d-flex align-items-center">
          {title}
          <Tooltip
            body={`This is a legacy "inline experiment" feature rule. New experiment rules must be created as references to experiments.`}
          >
            <HelperText status="info" size="sm" ml="3">
              legacy
            </HelperText>
          </Tooltip>
        </div>
      );
    }

    const linkedExperiment =
      rule.type === "experiment-ref" && experimentsMap.get(rule.experimentId);

    const rules = getRules(feature, environment);
    const permissionsUtil = usePermissionsUtil();

    const canEdit =
      !locked &&
      permissionsUtil.canViewFeatureModal(feature.project) &&
      permissionsUtil.canManageFeatureDrafts(feature);

    const isInactive = isRuleInactive(rule, experimentsMap);

    const hasCondition =
      (rule.condition && rule.condition !== "{}") ||
      !!rule.savedGroups?.length ||
      !!rule.prerequisites?.length;

    let safeRollout: SafeRolloutInterface | undefined;

    if (rule.type === "safe-rollout") {
      safeRollout = safeRolloutsMap.get(rule.safeRolloutId);
    }

    const info = getRuleMetaInfo({
      rule,
      experimentsMap,
      isDraft,
      unreachable,
    });

    if (hideInactive && isInactive) {
      return null;
    }

    const contents = (
      <Box {...props} ref={ref}>
        <Box mt="3">
          <Card>
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: "4px",
                backgroundColor:
                  info.sideColor === "disabled"
                    ? "var(--gray-5)"
                    : info.sideColor === "unreachable"
                      ? "var(--orange-7)"
                      : info.sideColor === "skipped"
                        ? "var(--amber-7)"
                        : "var(--green-9)",
              }}
            ></div>
            <Flex align="start" justify="between" gap="3" p="1" px="2">
              <Box>
                {rules.length > 1 && canEdit && (
                  <div
                    {...handle}
                    title="Drag and drop to re-order rules"
                    style={{ cursor: "grab" }}
                  >
                    <RiDraggable />
                  </div>
                )}
              </Box>
              <Box>
                {/* If there is a holdout, we need to add 1 to the index since the holdout rule is added above the other rules */}
                <Badge
                  label={<>{holdout ? i + 2 : i + 1}</>}
                  radius="full"
                  color="gray"
                />
              </Box>
              <Box flexGrow="1" pr="2">
                <Flex align="center" justify="between" mb="3" flexGrow="1">
                  <Flex
                    flexGrow="1"
                    gap="3"
                    justify="between"
                    mr="3"
                    align="center"
                  >
                    <Heading
                      as="h4"
                      size="3"
                      weight="medium"
                      mb="0"
                      className="w-100"
                    >
                      {linkedExperiment ? (
                        <Flex gap="3" align="center">
                          {linkedExperiment.type === "multi-armed-bandit"
                            ? "Bandit"
                            : "Experiment"}
                          :{" "}
                          <Link
                            href={`/${
                              linkedExperiment.type === "multi-armed-bandit"
                                ? "bandit"
                                : "experiment"
                            }/${linkedExperiment.id}`}
                          >
                            {linkedExperiment.name}
                          </Link>
                          <ExperimentStatusIndicator
                            experimentData={linkedExperiment}
                          />
                        </Flex>
                      ) : rule.type === "safe-rollout" ? (
                        <Flex gap="3">
                          <div>Safe Rollout</div>
                          <SafeRolloutStatusBadge rule={rule} />
                          {!locked && rule.enabled !== false ? (
                            <Flex
                              flexGrow="1"
                              justify="end"
                              style={{ marginBottom: -10 }}
                            >
                              <DecisionCTA
                                rule={rule}
                                openStatusModal={() => {
                                  setSafeRolloutStatusModalOpen(true);
                                }}
                              />
                            </Flex>
                          ) : null}
                        </Flex>
                      ) : (
                        title
                      )}
                    </Heading>
                    {info.pill}
                  </Flex>
                  {canEdit && (
                    <Flex>
                      <MoreMenu useRadix={true} size={14}>
                        <a
                          href="#"
                          className="dropdown-item"
                          onClick={(e) => {
                            e.preventDefault();
                            setRuleModal({ environment, i, mode: "edit" });
                          }}
                        >
                          Edit
                        </a>
                        <Button
                          color=""
                          className="dropdown-item"
                          onClick={async () => {
                            track(
                              rule.enabled
                                ? "Disable Feature Rule"
                                : "Enable Feature Rule",
                              {
                                ruleIndex: i,
                                environment,
                                type: rule.type,
                              },
                            );
                            const res = await apiCall<{ version: number }>(
                              `/feature/${feature.id}/${version}/rule`,
                              {
                                method: "PUT",
                                body: JSON.stringify({
                                  environment,
                                  rule: {
                                    ...rule,
                                    enabled: !rule.enabled,
                                  },
                                  i,
                                }),
                              },
                            );
                            await mutate();
                            res.version && setVersion(res.version);
                          }}
                        >
                          {rule.enabled ? "Disable" : "Enable"}
                        </Button>
                        {environments.length > 1 && (
                          <Button
                            color=""
                            className="dropdown-item"
                            onClick={() => {
                              setCopyRuleModal({ environment, rules: [rule] });
                            }}
                          >
                            Copy rule to environment(s)
                          </Button>
                        )}
                        {rule.type !== "experiment-ref" && (
                          <Button
                            color=""
                            className="dropdown-item"
                            onClick={() => {
                              setRuleModal({
                                environment,
                                i,
                                mode: "duplicate",
                              });
                            }}
                          >
                            Duplicate rule
                          </Button>
                        )}
                        <DeleteButton
                          className="dropdown-item"
                          displayName="Rule"
                          useIcon={false}
                          text="Delete"
                          onClick={async () => {
                            track("Delete Feature Rule", {
                              ruleIndex: i,
                              environment,
                              type: rule.type,
                            });
                            const res = await apiCall<{ version: number }>(
                              `/feature/${feature.id}/${version}/rule`,
                              {
                                method: "DELETE",
                                body: JSON.stringify({
                                  environment,
                                  i,
                                }),
                              },
                            );
                            await mutate();
                            res.version && setVersion(res.version);
                          }}
                        />
                      </MoreMenu>
                    </Flex>
                  )}
                </Flex>
                <Box>{info.callout}</Box>
                {attributesWithVersionStringOperatorMismatches &&
                  attributesWithVersionStringOperatorMismatches.length > 0 && (
                    <Callout status="warning" mt="3">
                      <Flex direction="column" gap="2">
                        <Text>
                          This rule uses string operators on version attributes,
                          which can have unintended effects. Edit this rule and
                          change{" "}
                          <strong>
                            {attributesWithVersionStringOperatorMismatches.join(
                              ", ",
                            )}
                          </strong>{" "}
                          to use version operators ($vgt, $vlt, etc.) instead.
                        </Text>
                      </Flex>
                    </Callout>
                  )}
                <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
                  {rule.type === "safe-rollout" && safeRollout ? (
                    <>
                      <DecisionHelpText rule={rule} />
                      {rule.description ? (
                        <Box pb="3">{rule.description}</Box>
                      ) : null}
                    </>
                  ) : null}
                  {hasCondition && rule.type !== "experiment-ref" && (
                    <Flex direction="row" gap="2" mb="3">
                      <Text weight="medium">IF</Text>
                      <Box>
                        <ConditionDisplay
                          condition={rule.condition || ""}
                          savedGroups={rule.savedGroups}
                          prerequisites={rule.prerequisites}
                        />
                      </Box>
                    </Flex>
                  )}
                  {rule.type === "force" && (
                    <ForceSummary value={rule.value} feature={feature} />
                  )}
                  {rule.type === "rollout" && (
                    <RolloutSummary
                      value={rule.value ?? ""}
                      coverage={rule.coverage ?? 1}
                      feature={feature}
                      hashAttribute={rule.hashAttribute || ""}
                    />
                  )}
                  {rule.type === "safe-rollout" &&
                    (safeRollout ? (
                      <Box>
                        <SafeRolloutSummary
                          safeRollout={safeRollout}
                          rule={rule}
                          feature={feature}
                        />
                        {safeRollout?.startedAt && (
                          <SafeRolloutStatusModal
                            safeRollout={safeRollout}
                            rule={rule}
                            feature={feature}
                            environment={environment}
                            i={i}
                            setVersion={setVersion}
                            mutate={mutate}
                            open={safeRolloutStatusModalOpen}
                            setStatusModalOpen={setSafeRolloutStatusModalOpen}
                            valueType={feature.valueType}
                          />
                        )}
                        {safeRollout?.startedAt && (
                          <Flex direction="column" mt="4" gap="4">
                            <SafeRolloutDetails safeRollout={safeRollout} />
                          </Flex>
                        )}
                        {!safeRollout?.startedAt && (
                          <Callout status="info" mt="4">
                            This Safe Rollout rule is in a draft state and will
                            start when this feature revision is published.
                          </Callout>
                        )}
                      </Box>
                    ) : (
                      <div>
                        {/* Better error state if safe rollout is not found */}
                        <p>Safe Rollout not found</p>
                      </div>
                    ))}
                  {rule.type === "experiment" && (
                    <ExperimentSummary
                      feature={feature}
                      experiment={Array.from(experimentsMap.values()).find(
                        (exp) =>
                          exp.trackingKey === (rule.trackingKey || feature.id),
                      )}
                      rule={rule}
                    />
                  )}
                  {rule.type === "experiment-ref" && (
                    <ExperimentRefSummary
                      feature={feature}
                      experiment={experimentsMap.get(rule.experimentId)}
                      rule={rule}
                      isDraft={isDraft}
                    />
                  )}
                </Box>
              </Box>
            </Flex>
          </Card>
        </Box>
      </Box>
    );

    return safeRollout ? (
      <SafeRolloutSnapshotProvider
        safeRollout={safeRollout}
        feature={feature}
        mutateSafeRollout={mutate}
      >
        {contents}
      </SafeRolloutSnapshotProvider>
    ) : (
      contents
    );
  },
);

export function SortableRule(props: SortableProps) {
  const { attributes, listeners, setNodeRef, transform, transition, active } =
    useSortable({ id: props.rule.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: active?.id === props.rule.id ? 0.3 : 1,
    margin: -1,
  };

  return (
    <Rule
      {...props}
      ref={setNodeRef}
      style={style}
      handle={{ ...attributes, ...listeners }}
    />
  );
}

function SkippedPill() {
  return (
    <Badge
      color="amber"
      label={
        <>
          <PiArrowBendRightDown />
          Skipped
        </>
      }
    />
  );
}

export type RuleMetaInfo = {
  pill?: ReactElement;
  callout?: ReactElement;
  sideColor: "active" | "skipped" | "disabled" | "unreachable";
};

export function getRuleMetaInfo({
  rule,
  experimentsMap,
  isDraft,
  unreachable,
}: {
  rule: FeatureRule;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  isDraft: boolean;
  unreachable?: boolean;
}): RuleMetaInfo {
  const linkedExperiment =
    rule.type === "experiment-ref"
      ? experimentsMap.get(rule.experimentId)
      : undefined;
  const ruleInactive = isRuleInactive(rule, experimentsMap);
  const ruleSkipped = isRuleSkipped({
    rule,
    linkedExperiment,
    isDraft,
  });

  const upcomingScheduleRule = getUpcomingScheduleRule(rule);

  const scheduleCompletedAndDisabled =
    !upcomingScheduleRule &&
    rule?.scheduleRules?.length &&
    rule.scheduleRules.at(-1)?.timestamp !== null;

  // Inactive due to explicitly being disabled
  if (!rule.enabled) {
    return {
      pill: (
        <Badge
          color="gray"
          title="Rule is not enabled"
          label={
            <>
              <RxCircleBackslash />
              Disabled
            </>
          }
        />
      ),
      sideColor: "disabled",
    };
  }

  // Inactive due to a schedule that is finished
  if (
    scheduleCompletedAndDisabled &&
    rule.scheduleRules &&
    rule.scheduleRules.length > 0
  ) {
    const lastRule = rule.scheduleRules[rule.scheduleRules.length - 1];
    if (lastRule && lastRule.timestamp) {
      return {
        pill: <SkippedPill />,
        callout: (
          <Callout status="warning">
            Disabled by a schedule on{" "}
            {new Date(lastRule.timestamp).toLocaleDateString()} at{" "}
            {formatTimeZone(new Date(lastRule.timestamp), "h:mm a z")}
          </Callout>
        ),
        sideColor: "skipped",
      };
    }
  }

  // Inactive for some other reason (e.g. experiment is archived)
  if (ruleInactive) {
    // Assume callout will be added by the rule summary
    return {
      pill: <SkippedPill />,
      sideColor: "skipped",
    };
  }

  // Skipped, but will be enabled on a schedule
  if (
    upcomingScheduleRule &&
    upcomingScheduleRule.enabled &&
    upcomingScheduleRule.timestamp
  ) {
    return {
      pill: <SkippedPill />,
      callout: (
        <Callout status="warning">
          Will be enabled on{" "}
          {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
          {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
        </Callout>
      ),
      sideColor: "skipped",
    };
  }

  // Skipped for some other reason
  if (ruleSkipped) {
    return {
      pill: <SkippedPill />,
      sideColor: "skipped",
    };
  }

  // Rule is not reachable
  if (unreachable) {
    return {
      pill: (
        <Badge
          color="orange"
          title="Rule not reachable"
          label={
            <>
              <RiAlertLine />
              Unreachable
            </>
          }
        />
      ),
      callout: (
        <Callout status="warning">
          Rules above will serve 100% of traffic and this rule will never be
          used
        </Callout>
      ),
      sideColor: "unreachable",
    };
  }

  // Active, but will be disabled on a schedule
  if (upcomingScheduleRule && upcomingScheduleRule.timestamp) {
    return {
      callout: (
        <Callout status="info">
          Will be disabled on{" "}
          {new Date(upcomingScheduleRule.timestamp).toLocaleDateString()} at{" "}
          {formatTimeZone(new Date(upcomingScheduleRule.timestamp), "h:mm a z")}
        </Callout>
      ),
      sideColor: "active",
    };
  }

  // Active
  return {
    sideColor: "active",
  };
}
