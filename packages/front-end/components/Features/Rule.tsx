import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef, useEffect, useState } from "react";
import {
  FaArrowsAlt,
  FaExclamationTriangle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { filterEnvironmentsByFeature } from "shared/dist/util";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import { getRules, isRuleDisabled, useEnvironments } from "@/services/features";
import { getUpcomingScheduleRule } from "@/services/scheduleRules";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import ExperimentSummary from "./ExperimentSummary";
import RuleStatusPill from "./RuleStatusPill";
import ExperimentRefSummary from "./ExperimentRefSummary";

interface SortableProps {
  i: number;
  rule: FeatureRule;
  feature: FeatureInterface;
  environment: string;
  mutate: () => void;
  setRuleModal: (args: { environment: string; i: number }) => void;
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

    const title =
      rule.description ||
      rule.type[0].toUpperCase() + rule.type.slice(1) + " Rule";

    const linkedExperiment =
      rule.type === "experiment-ref" && experimentsMap.get(rule.experimentId);

    const [rules, setItems] = useState(getRules(feature, environment));
    useEffect(() => {
      setItems(getRules(feature, environment));
    }, [feature, environment]);

    const moveItem = async (fromIndex, toIndex) => {
      if (toIndex >= 0 && toIndex < rules.length) {
        setItems(arrayMove(rules, fromIndex, toIndex));
        const res = await apiCall<{ version: number }>(
          `/feature/${feature.id}/${version}/reorder`,
          {
            method: "POST",
            body: JSON.stringify({
              environment,
              from: fromIndex,
              to: toIndex,
            }),
          }
        );
        await mutate();
        res.version && setVersion(res.version);
      }
    };

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

    if (hideDisabled && ruleDisabled) {
      return null;
    }
    return (
      <div
        className={`p-3 ${
          i < rules.length - 1 ? "border-bottom" : ""
        } bg-white`}
        {...props}
        ref={ref}
      >
        <div className="d-flex mb-2 align-items-center">
          <div>
            <Tooltip body={ruleDisabled ? "This rule will be skipped" : ""}>
              <div
                className={`text-light border rounded-circle text-center font-weight-bold ${
                  ruleDisabled ? "bg-secondary" : "bg-purple"
                }`}
                style={{
                  width: 28,
                  height: 28,
                  lineHeight: "28px",
                }}
              >
                {i + 1}
              </div>
            </Tooltip>
          </div>
          <div className="flex-1 mx-2">
            {linkedExperiment ? (
              <div>
                Experiment:{" "}
                <strong className="mr-3">{linkedExperiment.name}</strong>{" "}
                <Link href={`/experiment/${linkedExperiment.id}`}>
                  View Experiment{" "}
                  <FaExternalLinkAlt
                    className="small ml-1 position-relative"
                    style={{ top: "-1px" }}
                  />
                </Link>
              </div>
            ) : (
              title
            )}
            {unreachable && !ruleDisabled ? (
              <Tooltip body="A rule above this one will serve to 100% of the traffic, and this rule will never be reached.">
                <span className="ml-2 font-italic bg-secondary text-light border px-2 rounded d-inline-block">
                  {" "}
                  <FaExclamationTriangle className="text-warning" /> This rule
                  is not reachable
                </span>
              </Tooltip>
            ) : null}
          </div>
          <RuleStatusPill
            rule={rule}
            upcomingScheduleRule={upcomingScheduleRule}
            scheduleCompletedAndDisabled={!!scheduleCompletedAndDisabled}
            linkedExperiment={linkedExperiment || undefined}
          />
          {rules.length > 1 && canEdit && (
            <div
              {...handle}
              title="Drag and drop to re-order rules"
              className="mr-2"
            >
              <FaArrowsAlt />
            </div>
          )}
          {rules.length > 1 && canEdit && (
            <div>
              <Button
                onClick={() => moveItem(i, i - 1)}
                disabled={i === 0} // disable move up for the first item
              >
                ↑
              </Button>
              <Button
                onClick={() => moveItem(i, i + 1)}
                disabled={i === rules.length - 1} // disable move down for the last item
              >
                ↓
              </Button>
            </div>
          )}
          <div>
            {canEdit && (
              <MoreMenu>
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
          </div>
        </div>
        <div className="d-flex">
          <div
            style={{
              maxWidth: "100%",
              opacity: ruleDisabled ? 0.4 : 1,
            }}
            className="flex-1 pt-1 position-relative"
          >
            {hasCondition && rule.type !== "experiment-ref" && (
              <div className="row mb-3 align-items-top">
                <div className="col-auto d-flex align-items-center">
                  <strong>IF</strong>
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
                  (exp) => exp.trackingKey === (rule.trackingKey || feature.id)
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
          </div>
        </div>
      </div>
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
