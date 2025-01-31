import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, ReactElement } from "react";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature } from "shared/util";
import { Box, Card, Flex, Heading } from "@radix-ui/themes";
import { RiDraggable } from "react-icons/ri";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getRules, isRuleDisabled, useEnvironments } from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import HelperText from "@/components/Radix/HelperText";
import Badge from "@/components/Radix/Badge";
import RuleStatusMsg from "@/components/Features/RuleStatusMsg";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import ExperimentSummary from "./ExperimentSummary";
import RuleStatusPill from "./RuleStatusPill";
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
  hideDisabled?: boolean;
}

type RuleProps = SortableProps &
  React.HTMLAttributes<HTMLDivElement> & {
    handle?: React.HTMLAttributes<HTMLDivElement>;
  };

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
      hideDisabled,
      ...props
    },
    ref
  ) => {
    const { apiCall } = useAuth();

    const allEnvironments = useEnvironments();
    const environments = filterEnvironmentsByFeature(allEnvironments, feature);

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

    const upcomingScheduleRule = getUpcomingScheduleRule(rule);

    const scheduleCompletedAndDisabled =
      !upcomingScheduleRule &&
      rule?.scheduleRules?.length &&
      rule.scheduleRules.at(-1)?.timestamp !== null;

    const ruleDisabled = isRuleDisabled(rule, experimentsMap);

    const hasCondition =
      (rule.condition && rule.condition !== "{}") ||
      !!rule.savedGroups?.length ||
      !!rule.prerequisites?.length;

    const isSkipped =
      (upcomingScheduleRule && rule?.scheduleRules?.length) ||
      0 > 0 ||
      scheduleCompletedAndDisabled ||
      (linkedExperiment && isExperimentRefRuleSkipped(linkedExperiment));
    if (hideDisabled && ruleDisabled) {
      return null;
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
                backgroundColor: !rule.enabled
                  ? "var(--gray-5)"
                  : unreachable
                  ? "var(--orange-7)"
                  : isSkipped
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
              <Box width="100%">
                <Flex align="center" justify="between" mb="3">
                  <Heading as="h4" size="3" weight="medium" mb="0">
                    {linkedExperiment ? (
                      <>
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
                      </>
                    ) : (
                      title
                    )}
                  </Heading>
                  <RuleStatusPill
                    rule={rule}
                    ruleDisabled={ruleDisabled}
                    unreachable={unreachable}
                    upcomingScheduleRule={upcomingScheduleRule}
                    scheduleCompletedAndDisabled={
                      !!scheduleCompletedAndDisabled
                    }
                    linkedExperiment={linkedExperiment || undefined}
                  />
                </Flex>
                <Box>
                  <RuleStatusMsg
                    rule={rule}
                    ruleDisabled={ruleDisabled}
                    unreachable={unreachable}
                    upcomingScheduleRule={upcomingScheduleRule}
                    scheduleCompletedAndDisabled={
                      !!scheduleCompletedAndDisabled
                    }
                    linkedExperiment={linkedExperiment || undefined}
                  />
                </Box>
                <Box style={{ opacity: ruleDisabled ? 0.6 : 1 }} mt="3">
                  {hasCondition && rule.type !== "experiment-ref" && (
                    <div className="row mb-3 align-items-top">
                      <div className="col-auto d-flex align-items-center">
                        <strong className="font-weight-semibold">IF</strong>
                      </div>
                      <div className="col">
                        <ConditionDisplay
                          condition={rule.condition || ""}
                          savedGroups={rule.savedGroups}
                          prerequisites={rule.prerequisites}
                        />
                      </div>
                    </div>
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
                    />
                  )}
                </Box>
              </Box>
              <Box>
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
              </Box>
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
