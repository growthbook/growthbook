/* eslint-disable react-hooks/exhaustive-deps */

import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExternalLinkAlt, FaMinusCircle, FaPlusCircle } from "react-icons/fa";
import React, { useEffect, useMemo, useState } from "react";
import { evaluatePrerequisiteState, PrerequisiteState } from "shared/util";
import { BiHide, BiShow } from "react-icons/bi";
import ValueDisplay from "@/components/Features/ValueDisplay";
import {
  getDefaultPrerequisiteCondition,
  getFeatureDefaultValue,
  useFeaturesList,
} from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";

export interface Props {
  value: FeaturePrerequisite[];
  setValue: (prerequisites: FeaturePrerequisite[]) => void;
  feature: FeatureInterface;
  environment: string;
}

export default function PrerequisiteTargetingField({
  value,
  setValue,
  feature,
  environment,
}: Props) {
  const { features } = useFeaturesList();
  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => (f.project || "") === (feature.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const [conditionKeys, forceConditionRender] = useArrayIncrementer();

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
                  envs={[environment]}
                  features={features}
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
            className="ml-2 text-purple hover-underline cursor-pointer"
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
          <em className="text-muted mr-3">
            No prerequisite targeting applied.
          </em>
          <div
            className="ml-1 mt-2 text-purple hover-underline cursor-pointer"
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
  envs,
  features,
}: {
  parentFeature?: FeatureInterface;
  envs: string[];
  features: FeatureInterface[];
}) {
  const [showDetails, setShowDetails] = useState(false);

  const prereqStates = useMemo(() => {
    if (!parentFeature) return null;
    const states: Record<string, PrerequisiteState> = {};
    envs.forEach((env) => {
      states[env] = evaluatePrerequisiteState(parentFeature, features, env);
    });
    return states;
  }, [parentFeature, features, envs]);

  if (!parentFeature) {
    return null;
  }

  return (
    <>
      <div className="d-flex align-items-center mt-1">
        <div className="flex-1" />
        <span
          className="text-purple hover-underline cursor-pointer"
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
                      maxHeight: 120,
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
    </>
  );
}
