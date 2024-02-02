/* eslint-disable react-hooks/exhaustive-deps */

import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import {
  FaExclamationTriangle,
  FaExternalLinkAlt,
  FaMinusCircle,
  FaPlusCircle,
} from "react-icons/fa";
import React, { useEffect, useMemo, useState } from "react";
import {
  evaluatePrerequisiteState,
  getDefaultPrerequisiteCondition,
  isPrerequisiteConditionConditional,
  PrerequisiteState,
} from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import {
  getConnectionSDKCapabilities,
  getConnectionsSDKCapabilities,
} from "shared/sdk-versioning";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue, useFeaturesList } from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";

export interface Props {
  value: FeaturePrerequisite[];
  setValue: (prerequisites: FeaturePrerequisite[]) => void;
  feature?: FeatureInterface;
  environments: string[];
  setPrerequisiteTargetingSdkIssues: (b: boolean) => void;
}

export default function PrerequisiteTargetingField({
  value,
  setValue,
  feature,
  environments,
  setPrerequisiteTargetingSdkIssues,
}: Props) {
  const { features } = useFeaturesList();
  const featureOptions = features
    .filter((f) => f.id !== feature?.id)
    .filter((f) => (f.project || "") === (feature?.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const [conditionKeys, forceConditionRender] = useArrayIncrementer();

  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("prerequisites");

  const { hasCommercialFeature } = useUser();
  const hasPrerequisitesCommercialFeature = hasCommercialFeature(
    "prerequisites"
  );

  useEffect(() => {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const parentFeature = features.find((f) => f.id === v.id);
      const parentCondition = v.condition;
      if (parentFeature) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteCondition(parentFeature);
          setValue([
            ...value.slice(0, i),
            {
              id: v.id,
              condition: condStr,
            },
            ...value.slice(i + 1),
          ]);
          forceConditionRender(i);
        }
      }
    }
  }, [JSON.stringify(value)]);

  const prereqStatesArr: (Record<
    string,
    PrerequisiteState
  > | null)[] = useMemo(() => {
    return value.map((v) => {
      const parentFeature = features.find((f) => f.id === v.id);
      if (!parentFeature) return null;
      const states: Record<string, PrerequisiteState> = {};
      environments.forEach((env) => {
        states[env] = evaluatePrerequisiteState(parentFeature, features, env);
      });
      return states;
    });
  }, [value, features, environments]);

  const blockedBySdkLimitations = useMemo(() => {
    for (let i = 0; i < prereqStatesArr.length; i++) {
      const parentCondition = value[i].condition;
      const prereqStates = prereqStatesArr[i];
      if (!prereqStates) continue;
      const hasConditionalState = Object.values(prereqStates).some(
        (s) => s === "conditional"
      );
      const hasNonStandardTargeting = isPrerequisiteConditionConditional(
        parentCondition,
        hasConditionalState ? "conditional" : "on"
      );
      if (
        !hasSDKWithPrerequisites &&
        (hasConditionalState || hasNonStandardTargeting)
      ) {
        return true;
      }
    }
    return false;
  }, [prereqStatesArr, features, value, hasSDKWithPrerequisites]);

  useEffect(() => {
    setPrerequisiteTargetingSdkIssues(blockedBySdkLimitations);
  }, [blockedBySdkLimitations, setPrerequisiteTargetingSdkIssues]);

  return (
    <div className="form-group my-4">
      <PremiumTooltip commercialFeature={"prerequisite-targeting"}>
        <label>Target by Prerequisite Features</label>
      </PremiumTooltip>
      {value.length > 0 ? (
        <>
          {value.map((v, i) => {
            const parentFeature = features.find((f) => f.id === v.id);

            const parentCondition = value[i].condition;
            const prereqStates = prereqStatesArr[i];
            const hasConditionalState = Object.values(prereqStates || {}).some(
              (s) => s === "conditional"
            );
            const hasConditionalTargeting = isPrerequisiteConditionConditional(
              parentCondition,
              hasConditionalState ? "conditional" : "on"
            );

            return (
              <div key={i} className="appbox bg-light px-3 py-3">
                <div className="row mb-1">
                  <div className="col">
                    <label className="mb-0">Feature</label>
                  </div>
                  <div className="col-md-auto col-sm-12">
                    <button
                      className="btn btn-link py-0 text-danger position-relative"
                      style={{ top: -4 }}
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setValue([...value.slice(0, i), ...value.slice(i + 1)]);
                      }}
                    >
                      <FaMinusCircle className="mr-1" />
                      remove
                    </button>
                  </div>
                </div>

                <div className="row">
                  <div className="col">
                    <SelectField
                      placeholder="Select feature"
                      options={featureOptions}
                      value={v.id}
                      onChange={(v) => {
                        setValue([
                          ...value.slice(0, i),
                          {
                            id: v,
                            condition: "",
                          },
                          ...value.slice(i + 1),
                        ]);
                      }}
                      key={`parentId-${i}`}
                      sort={false}
                    />
                  </div>
                </div>

                <PrereqStatesRows
                  parentFeature={parentFeature}
                  prereqStates={prereqStatesArr[i]}
                  environments={environments}
                />

                {parentFeature && hasConditionalState ? (
                  <PrerequisiteAlerts
                    issue="conditional-prerequisite"
                    environments={environments}
                  />
                ) : null}

                <div className="mt-2">
                  {parentFeature ? (
                    <PrerequisiteInput
                      defaultValue={v.condition}
                      onChange={(s) => {
                        setValue([
                          ...value.slice(0, i),
                          {
                            id: v.id,
                            condition: s,
                          },
                          ...value.slice(i + 1),
                        ]);
                      }}
                      parentFeature={parentFeature}
                      prereqStates={prereqStates}
                      key={conditionKeys[i]}
                    />
                  ) : null}
                </div>

                {parentFeature && hasConditionalTargeting ? (
                  <PrerequisiteAlerts
                    issue="conditional-targeting"
                    environments={environments}
                  />
                ) : null}
              </div>
            );
          })}

          <button
            className="btn p-0 ml-2 link-purple font-weight-bold"
            disabled={!hasPrerequisitesCommercialFeature}
            onClick={(e) => {
              e.preventDefault();
              setValue([
                ...value,
                {
                  id: "",
                  condition: "",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            Add prerequisite
          </button>
        </>
      ) : (
        <div>
          <div className="font-italic text-muted mr-3">
            No prerequisite targeting applied.
          </div>
          <button
            className="btn p-0 ml-1 mt-2 link-purple font-weight-bold"
            disabled={!hasPrerequisitesCommercialFeature}
            onClick={(e) => {
              e.preventDefault();
              setValue([
                ...value,
                {
                  id: "",
                  condition: "{}",
                },
              ]);
            }}
          >
            <GBAddCircle className="mr-1" />
            Add prerequisite targeting
          </button>
        </div>
      )}
    </div>
  );
}

function PrereqStatesRows({
  parentFeature,
  prereqStates,
  environments,
}: {
  parentFeature?: FeatureInterface;
  prereqStates: Record<string, PrerequisiteState> | null;
  environments: string[];
}) {
  const [showDetails, setShowDetails] = useState(true);

  if (!parentFeature) {
    return null;
  }

  return (
    <>
      <div className="d-flex align-items-center mt-1">
        <div className="flex-1" />
        <span
          className="link-purple cursor-pointer"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? (
            <>
              <BiHide /> Hide details
            </>
          ) : (
            <>
              <BiShow /> Show details
            </>
          )}
        </span>
      </div>

      {showDetails && (
        <div>
          <div className="mb-2">
            <a
              className="a nowrap"
              href={`/features/${parentFeature.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {parentFeature.id}
              <FaExternalLinkAlt className="ml-1" />
            </a>
          </div>
          <table className="table mb-4 border bg-white">
            <thead className="text-dark">
              <tr>
                <th className="pl-4">Type</th>
                <th className="border-right">Default value</th>
                {environments.map((env) => (
                  <th key={env} className="text-center">
                    {env}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pl-4">
                  {parentFeature.valueType === "json"
                    ? "JSON"
                    : parentFeature.valueType}
                </td>
                <td className="border-right" style={{ maxWidth: 400 }}>
                  <ValueDisplay
                    value={getFeatureDefaultValue(parentFeature)}
                    type={parentFeature.valueType}
                    fullStyle={{
                      maxHeight: 80,
                      overflowY: "auto",
                      overflowX: "auto",
                      maxWidth: "100%",
                    }}
                  />
                </td>
                <PrerequisiteStatesCols
                  prereqStates={prereqStates ?? undefined}
                  envs={environments}
                />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export const PrerequisiteAlerts = ({
  issue,
  environments,
  type = "prerequisite",
}: {
  issue: "conditional-prerequisite" | "conditional-targeting";
  environments: string[];
  type?: "feature" | "prerequisite";
}) => {
  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("prerequisites");

  const hasSDKWithNoPrerequisites = (sdkConnectionsData?.connections || [])
    .map((sdk) => getConnectionSDKCapabilities(sdk))
    .some((c) => !c.includes("prerequisites"));

  if (!hasSDKWithNoPrerequisites) {
    return null;
  }

  return (
    <div
      className={`mt-2 mb-3 alert ${
        hasSDKWithPrerequisites ? "text-warning-orange py-0" : "alert-danger"
      }`}
    >
      <div>
        <FaExclamationTriangle className="mr-1" />
        {issue === "conditional-prerequisite" && (
          <>
            This {type} is in a{" "}
            <span className="text-purple font-weight-bold">
              Schrödinger state
            </span>{" "}
            {environments.length > 1
              ? "in some environments"
              : "in this environment"}{" "}
            and must be evaluated at runtime in the SDK.{" "}
          </>
        )}
        {issue === "conditional-targeting" && (
          <>
            The selected targeting condition gives this prerequisite a{" "}
            <span className="text-purple font-weight-bold">
              Schrödinger state
            </span>
            . This means that we can&apos;t know if it passes or not until
            it&apos;s evaluated at runtime in the SDK.{" "}
          </>
        )}
        {hasSDKWithPrerequisites ? (
          <>
            However, some of your{" "}
            <a href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
            may not support prerequisite evaluation.
          </>
        ) : (
          <>
            However, none of your{" "}
            <a href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
            support prerequisite evaluation. Either upgrade your SDKs
            {issue === "conditional-targeting"
              ? ", change the targeting condition, "
              : ""}{" "}
            or{" "}
            {type === "prerequisite"
              ? "remove this prerequisite"
              : "remove Schrödinger prerequisites"}
            .
          </>
        )}{" "}
        <Tooltip
          body={
            <>
              Prerequisite evaluation is only supported in the following SDKs
              and versions:
              <ul className="mb-1">
                <li>Javascript &gt;= 0.33.0</li>
                <li>React &gt;= 0.23.0</li>
              </ul>
            </>
          }
        />
      </div>
    </div>
  );
};
