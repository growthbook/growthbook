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
  PrerequisiteState,
} from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import {
  getConnectionSDKCapabilities,
  getConnectionsSDKCapabilities,
} from "shared/dist/sdk-versioning";
import ValueDisplay from "@/components/Features/ValueDisplay";
import { getFeatureDefaultValue, useFeaturesList } from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import useSDKConnections from "@/hooks/useSDKConnections";
import Tooltip from "@/components/Tooltip/Tooltip";
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

  useEffect(() => {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const parentFeature = features.find((f) => f.id === v.id);
      const parentCondition = v.condition;
      if (parentFeature) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteCondition();
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
      const hasNonStandardTargeting =
        parentCondition !== getDefaultPrerequisiteCondition();
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
      <label>Target by Prerequisite Features</label>
      {value.length > 0 ? (
        <>
          {value.map((v, i) => {
            const parentFeature = features.find((f) => f.id === v.id);

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
                  parentCondition={value[i].condition}
                  prereqStates={prereqStatesArr[i]}
                  envs={environments}
                />

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
                      key={conditionKeys[i]}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}

          <span
            className="ml-2 link-purple font-weight-bold cursor-pointer"
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
          </span>
        </>
      ) : (
        <div>
          <div className="font-italic text-muted mr-3">
            No prerequisite targeting applied.
          </div>
          <div
            className="d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer"
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
          </div>
        </div>
      )}
    </div>
  );
}

function PrereqStatesRows({
  parentFeature,
  parentCondition,
  prereqStates,
  envs,
}: {
  parentFeature?: FeatureInterface;
  parentCondition: string;
  prereqStates: Record<string, PrerequisiteState> | null;
  envs: string[];
}) {
  const { data: sdkConnectionsData } = useSDKConnections();

  const [showDetails, setShowDetails] = useState(true);

  const hasConditionalState =
    prereqStates &&
    Object.values(prereqStates).some((s) => s === "conditional");

  const hasSDKWithPrerequisites = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("prerequisites");

  const hasSDKWithNoPrerequisites = (sdkConnectionsData?.connections || [])
    .map((sdk) => getConnectionSDKCapabilities(sdk))
    .some((c) => !c.includes("prerequisites"));

  const hasNonStandardTargeting =
    parentCondition !== getDefaultPrerequisiteCondition();

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
                {envs.map((env) => (
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
                  envs={envs}
                />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {hasSDKWithNoPrerequisites &&
        (hasConditionalState || hasNonStandardTargeting) && (
          <div
            className={`mt-2 alert ${
              hasSDKWithPrerequisites
                ? "text-warning-orange py-0"
                : "alert-danger"
            }`}
          >
            <div>
              <FaExclamationTriangle className="mr-1" />
              {hasConditionalState && (
                <>
                  This prerequisite is{" "}
                  <span className="text-purple font-weight-bold">
                    conditionally enabled
                  </span>{" "}
                  {envs.length > 1
                    ? "in one or more environments"
                    : "in this environment"}
                  .{" "}
                </>
              )}
              {hasNonStandardTargeting && (
                <>
                  {hasConditionalState ? "Additionally, the" : "The"} targeting
                  condition is non-standard, which requires conditional
                  evaluation.{" "}
                </>
              )}
              Conditional prerequisite evaluation happens in the SDK; therefore
              a compatible SDK version is required.{" "}
              <Tooltip
                body={
                  <>
                    <div>
                      {hasSDKWithPrerequisites
                        ? "Some of your SDK Connections may not support prerequisite evaluation. Use at your own risk."
                        : `None of your SDK Connections currently support prerequisite evaluation. Either upgrade your SDKs${
                            hasNonStandardTargeting && !hasConditionalState
                              ? ", use default targeting, "
                              : ""
                          } or remove this prerequisite.`}
                    </div>
                    <div className="mt-2">
                      Prerequisite evaluation is only supported in the following
                      SDKs and versions:
                      <ul className="mb-1">
                        <li>Javascript &gt;= 0.33.0</li>
                        <li>React &gt;= 0.23.0</li>
                      </ul>
                    </div>
                  </>
                }
              />
            </div>
          </div>
        )}
    </>
  );
}
