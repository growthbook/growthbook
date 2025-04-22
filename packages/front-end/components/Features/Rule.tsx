import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, ReactElement, useState } from "react";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature } from "shared/util";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { RiAlertLine, RiDraggable } from "react-icons/ri";
import { RxCircleBackslash } from "react-icons/rx";
import { PiArrowBendRightDown } from "react-icons/pi";
import { format as formatTimeZone } from "date-fns-tz";
import { SafeRolloutInterface } from "back-end/src/validators/safe-rollout";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getRules, isRuleInactive, useEnvironments } from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/components/Radix/HelperText";
import Badge from "@/components/Radix/Badge";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Callout from "@/components/Radix/Callout";
import SafeRolloutSummary from "@/components/Features/SafeRolloutSummary";
import SafeRolloutSnapshotProvider from "@/components/SafeRollout/SnapshotProvider";
import SafeRolloutDetails from "@/components/SafeRollout/SafeRolloutDetails";
import SafeRolloutStatusModal from "@/components/Features/SafeRollout/SafeRolloutStatusModal";
import DecisionBanner from "../SafeRollout/DecisionBanner";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import ExperimentSummary from "./ExperimentSummary";
import FeatureUsageGraph, { useFeatureUsage } from "./FeatureUsageGraph";
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
    duplicate?: boolean;
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
      ...props
    },
    ref
  ) => {
    const { apiCall } = useAuth();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);
    const { featureUsage } = useFeatureUsage();
    const [
      safeRolloutStatusModalOpen,
      setSafeRolloutStatusModalOpen,
    ] = useState(false);
    let title: string | ReactElement =
      rule.description ||
      rule.type[0].toUpperCase() + rule.type.slice(1) + " Rule";
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

    const isInactive = isRuleInactive(rule, experimentsMap, safeRolloutsMap);

    const hasCondition =
      (rule.condition && rule.condition !== "{}") ||
      !!rule.savedGroups?.length ||
      !!rule.prerequisites?.length;

    const info = getRuleMetaInfo({
      rule,
      experimentsMap,
      safeRolloutsMap,
      isDraft,
      unreachable,
    });

    if (hideInactive && isInactive) {
      return null;
    }

    let safeRollout: SafeRolloutInterface | undefined;

    if (rule.type === "safe-rollout") {
      safeRollout = safeRolloutsMap.get(rule.safeRolloutId);
    }
    return (
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
                <Badge label={<>{i + 1}</>} radius="full" color="gray" />
              </Box>
              <Box flexGrow="1" flexShrink="5" overflowX="auto">
                <Flex align="center" justify="between" mb="3">
                  <Heading as="h4" size="3" weight="medium" mb="0">
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
                      <Flex gap="3" align="center">
                        <div>{title}</div>
                      </Flex>
                    ) : (
                      title
                    )}
                  </Heading>
                  {info.pill}
                </Flex>
                <Box>{info.callout}</Box>
                <Box style={{ opacity: isInactive ? 0.6 : 1 }} mt="3">
                  {hasCondition && rule.type !== "experiment-ref" && (
                    <Flex align="center" justify="start" gap="3">
                      <Box pb="3">
                        <strong className="font-weight-semibold">IF</strong>
                      </Box>
                      <Box
                        width="100%"
                        flexShrink="4"
                        flexGrow="1"
                        overflowX="auto"
                        pb="3"
                      >
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
                      <SafeRolloutSnapshotProvider
                        safeRollout={safeRollout}
                        feature={feature}
                      >
                        <SafeRolloutSummary
                          safeRollout={safeRollout}
                          rule={rule}
                          feature={feature}
                        />

                        {safeRollout?.startedAt && (
                          <SafeRolloutStatusModal
                            safeRollout={safeRollout}
                            rule={rule}
                            featureId={feature.id}
                            environment={environment}
                            version={version}
                            i={i}
                            setVersion={setVersion}
                            mutate={mutate}
                            open={safeRolloutStatusModalOpen}
                            setStatusModalOpen={setSafeRolloutStatusModalOpen}
                            defaultStatus={safeRollout.status}
                          />
                        )}
                        {safeRollout?.startedAt && (
                          <Box mt="3">
                            {rule.enabled && (
                              <DecisionBanner
                                openStatusModal={() =>
                                  setSafeRolloutStatusModalOpen(true)
                                }
                                rule={rule}
                              />
                            )}
                            <SafeRolloutDetails
                              safeRollout={safeRollout}
                              feature={feature}
                            />{" "}
                          </Box>
                        )}
                        {!safeRollout?.startedAt && (
                          <Callout status="info" mt="2">
                            This safe rollout is in a draft state and will not
                            start until this feature revision is published.
                          </Callout>
                        )}
                      </SafeRolloutSnapshotProvider>
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
                          exp.trackingKey === (rule.trackingKey || feature.id)
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
              <Flex>
                {featureUsage && (
                  <div className="ml-auto">
                    <FeatureUsageGraph
                      data={
                        featureUsage?.environments?.[environment]?.rules?.[
                          rule.id
                        ]
                      }
                    />
                  </div>
                )}
                {canEdit && (
                  <MoreMenu useRadix={true} size={14}>
                    <a
                      href="#"
                      className="dropdown-item"
                      onClick={(e) => {
                        e.preventDefault();
                        setRuleModal({ environment, i });
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
                          }
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
                          }
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
                          setRuleModal({ environment, i, duplicate: true });
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
                          }
                        );
                        await mutate();
                        res.version && setVersion(res.version);
                      }}
                    />
                  </MoreMenu>
                )}
              </Flex>
            </Flex>
          </Card>
        </Box>
      </Box>
    );
  }
);

export function SortableRule(props: SortableProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    active,
  } = useSortable({ id: props.rule.id });

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
  safeRolloutsMap,
  isDraft,
  unreachable,
}: {
  rule: FeatureRule;
  experimentsMap: Map<string, ExperimentInterfaceStringDates>;
  safeRolloutsMap: Map<string, SafeRolloutInterface>;
  isDraft: boolean;
  unreachable?: boolean;
}): RuleMetaInfo {
  const linkedExperiment =
    rule.type === "experiment-ref"
      ? experimentsMap.get(rule.experimentId)
      : undefined;
  const ruleInactive = isRuleInactive(rule, experimentsMap, safeRolloutsMap);
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
