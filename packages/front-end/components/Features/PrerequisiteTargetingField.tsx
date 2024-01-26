/* eslint-disable react-hooks/exhaustive-deps */

import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { evaluatePrerequisiteState, PrerequisiteState } from "shared/util";
import ValueDisplay from "@/components/Features/ValueDisplay";
import {
  getDefaultPrerequisiteCondition,
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
} from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import styles from "@/components/Features/ConditionInput.module.scss";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
import { PrerequisiteStatesCols } from "@/components/Features/PrerequisiteStatusRow";
import { GBAddCircle } from "../Icons";
import SelectField from "../Forms/SelectField";

export interface Props {
  value: FeaturePrerequisite[];
  setValue: (prerequisites: FeaturePrerequisite[]) => void;
  feature: FeatureInterface;
}

export default function PrerequisiteTargetingField({
  value,
  setValue,
  feature,
}: Props) {
  const { features } = useFeaturesList();
  const featureOptions = features
    .filter((f) => f.id !== feature.id)
    .filter((f) => (f.project || "") === (feature.project || ""))
    .map((f) => ({ label: f.id, value: f.id }));

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

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
    <div className="form-group">
      <label>Target by Prerequisite Features</label>
      <div className="border bg-light px-3 pb-3 mb-1">
        {value.length > 0 ? (
          <>
            <ul className={styles.conditionslist}>
              {value.map((v, i) => {
                const parentFeature = features.find((f) => f.id === v.id);

                return (
                  <li key={i} className={styles.listitem}>
                    <div className="row mb-1">
                      <div className="col">
                        <label className="mb-0">Feature</label>
                      </div>
                      <div className="col-md-auto col-sm-12">
                        <button
                          className="btn btn-link py-0 text-danger"
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setValue([
                              ...value.slice(0, i),
                              ...value.slice(i + 1),
                            ]);
                          }}
                        >
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
                      envs={envs}
                      features={features}
                    />

                    <div className="mt-3">
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
                  </li>
                );
              })}
            </ul>
            <a
              role="button"
              className="btn btn-outline-primary"
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
              <span className="pr-2">
                <GBAddCircle />
              </span>
              Add another prerequisite
            </a>
          </>
        ) : (
          <div className="mt-3">
            <em className="text-muted mr-3">
              No prerequisite targeting applied.
            </em>
            <a
              className="a"
              role="button"
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
              Add prerequisite targeting
            </a>
          </div>
        )}
      </div>
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
      <div className="d-flex align-items-center mt-2">
        <div style={{ width: 110 }}>
          <span
            className="text-purple hover-underline cursor-pointer"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? "Hide details" : "Show details"}
          </span>
        </div>
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

      {showDetails && (
        <div className="mt-3">
          <table className="table mb-4 border">
            <thead className="bg-light text-dark">
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
                <td className="border-right">
                  <div
                    className={clsx({
                      small: parentFeature.valueType === "json",
                    })}
                  >
                    <ValueDisplay
                      value={getFeatureDefaultValue(parentFeature)}
                      type={parentFeature.valueType}
                      full={false}
                    />
                  </div>
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
