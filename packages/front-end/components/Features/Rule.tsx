import { FeatureInterface, FeatureRule } from "back-end/types/feature";
import { useAuth } from "../../services/auth";
import Button from "../Button";
import DeleteButton from "../DeleteButton";
import MoreMenu from "../Dropdown/MoreMenu";
import ConditionDisplay from "./ConditionDisplay";
import ForceSummary from "./ForceSummary";
import RolloutSummary from "./RolloutSummary";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import React, { forwardRef } from "react";
import { FaArrowsAlt } from "react-icons/fa";
import ExperimentSummary from "./ExperimentSummary";
import track from "../../services/track";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getEnvironmentUpdates, getRules } from "../../services/features";

interface SortableProps {
  i: number;
  rule: FeatureRule;
  feature: FeatureInterface;
  environment: string;
  experiments: Record<string, ExperimentInterfaceStringDates>;
  mutate: () => void;
  setRuleModal: ({ environment: string, i: number }) => void;
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
      mutate,
      handle,
      experiments,
      ...props
    },
    ref
  ) => {
    const { apiCall } = useAuth();
    const type = feature.valueType;
    const title =
      rule.description ||
      rule.type[0].toUpperCase() + rule.type.slice(1) + " Rule";

    const rules = getRules(feature, environment);

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
            <div
              className="text-light border rounded-circle"
              style={{
                width: 28,
                height: 28,
                lineHeight: "28px",
                textAlign: "center",
                background: "#7C45EA",
                fontWeight: "bold",
                opacity: !rule.enabled ? 0.5 : 1,
              }}
            >
              {i + 1}
            </div>
          </div>
          <div
            style={{ flex: 1, opacity: !rule.enabled ? 0.5 : 1 }}
            className="mx-2"
          >
            {title}
          </div>
          {!rule.enabled && (
            <div className="mr-3">
              <div className="bg-secondary text-light border px-2 rounded">
                DISABLED
              </div>
            </div>
          )}
          {rules.length > 1 && (
            <div
              {...handle}
              title="Drag and drop to re-order rules"
              className="mr-2"
            >
              <FaArrowsAlt />
            </div>
          )}
          <div>
            <MoreMenu id={"edit_rule_" + rule.id}>
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
                  const newRules = [...rules];
                  newRules[i] = { ...newRules[i] };
                  newRules[i].enabled = !newRules[i].enabled;
                  track(
                    rule.enabled
                      ? "Disable Feature Rule"
                      : "Enable Feature Rule",
                    {
                      ruleIndex: i,
                      environment,
                      type: newRules[i].type,
                    }
                  );
                  await apiCall(`/feature/${feature.id}`, {
                    method: "PUT",
                    body: JSON.stringify(
                      getEnvironmentUpdates(feature, environment, {
                        rules: newRules,
                      })
                    ),
                  });
                  mutate();
                }}
              >
                {rule.enabled ? "Disable" : "Enable"}
              </Button>
              <Button
                color=""
                className="dropdown-item"
                onClick={async () => {
                  const newEnv = environment === "dev" ? "production" : "dev";
                  const newRules = [
                    ...getRules(feature, newEnv),
                    { ...rule, id: "" },
                  ];
                  await apiCall(`/feature/${feature.id}`, {
                    method: "PUT",
                    body: JSON.stringify(
                      getEnvironmentUpdates(feature, newEnv, {
                        rules: newRules,
                      })
                    ),
                  });
                  mutate();
                }}
              >
                Copy to {environment === "dev" ? "production" : "dev"}
              </Button>
              <DeleteButton
                className="dropdown-item"
                displayName="Rule"
                useIcon={false}
                text="Delete"
                onClick={async () => {
                  track("Delete Feature Rule", {
                    ruleIndex: i,
                    environment,
                    type: rules[i].type,
                  });
                  const newRules = [...rules];
                  newRules.splice(i, 1);
                  await apiCall(`/feature/${feature.id}`, {
                    method: "PUT",
                    body: JSON.stringify(
                      getEnvironmentUpdates(feature, environment, {
                        rules: newRules,
                      })
                    ),
                  });
                  mutate();
                }}
              />
            </MoreMenu>
          </div>
        </div>
        <div className="d-flex">
          <div style={{ flex: 1 }} className="pt-1 position-relative">
            {!rule.enabled && (
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 99,
                  background: "rgba(255,255,255,.7)",
                  display: "flex",
                  flexDirection: "column",
                  fontSize: 25,
                }}
              ></div>
            )}
            {rule.condition && rule.condition !== "{}" && (
              <div className="row mb-3 align-items-top">
                <div className="col-auto">
                  <strong>IF</strong>
                </div>
                <div className="col">
                  <ConditionDisplay condition={rule.condition} />
                </div>
              </div>
            )}
            {rule.type === "force" && (
              <ForceSummary value={rule.value} type={type} />
            )}
            {rule.type === "rollout" && (
              <RolloutSummary
                value={rule.value ?? ""}
                coverage={rule.coverage ?? 1}
                type={type}
                hashAttribute={rule.hashAttribute || ""}
              />
            )}
            {rule.type === "experiment" && (
              <ExperimentSummary
                values={rule.values}
                type={type}
                feature={feature}
                experiment={experiments[rule.trackingKey || feature.id]}
                hashAttribute={rule.hashAttribute || ""}
                trackingKey={rule.trackingKey || feature.id}
                expRule={rule}
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
