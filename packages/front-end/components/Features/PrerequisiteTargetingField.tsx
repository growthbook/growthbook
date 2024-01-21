/* eslint-disable react-hooks/exhaustive-deps */

import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExternalLinkAlt, FaInfoCircle } from "react-icons/fa";
import clsx from "clsx";
import React, { useEffect } from "react";
import ValueDisplay from "@/components/Features/ValueDisplay";
import {
  getDefaultPrerequisiteParentCondition,
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
} from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
import styles from "@/components/Features/ConditionInput.module.scss";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useArrayIncrementer } from "@/hooks/useIncrementer";
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

  const [conditionKeys, forceConditionRender] = useArrayIncrementer();

  useEffect(() => {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      const parentFeature = features.find((f) => f.id === v.parentId);
      const parentCondition = v.parentCondition;
      if (parentFeature) {
        if (parentCondition === "" || parentCondition === "{}") {
          const condStr = getDefaultPrerequisiteParentCondition(parentFeature);
          setValue([
            ...value.slice(0, i),
            {
              parentId: v.parentId,
              parentCondition: condStr,
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
                const parentFeature = features.find((f) => f.id === v.parentId);
                const parentFeatureId = parentFeature?.id;

                return (
                  <li key={i} className={styles.listitem}>
                    <div className="row">
                      <div className="col-auto">
                        <div className={`ml-2 ${styles.passif}`}>IF</div>
                      </div>
                      <div className="col-3 ml-3 pr-1">
                        <div className="">
                          <SelectField
                            placeholder="Select feature"
                            options={featureOptions}
                            value={v.parentId}
                            onChange={(v) => {
                              setValue([
                                ...value.slice(0, i),
                                {
                                  parentId: v,
                                  parentCondition: "",
                                },
                                ...value.slice(i + 1),
                              ]);
                            }}
                            key={`parentId-${i}`}
                            sort={false}
                          />
                        </div>
                        {parentFeature ? (
                          <div className="col-auto d-flex align-items-center">
                            <div className="mr-3 nowrap text-info cursor-pointer">
                              <Tooltip
                                popperStyle={{ minWidth: 450, maxWidth: 650 }}
                                body={
                                  <table className="table mb-0">
                                    <thead className="uppercase-title text-muted">
                                      <tr>
                                        <th className="border-top-0">Type</th>
                                        <th className="border-top-0">
                                          Default value
                                        </th>
                                        <th className="border-top-0">
                                          Environments
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      <tr>
                                        <td>
                                          {parentFeature.valueType === "json"
                                            ? "JSON"
                                            : parentFeature.valueType}
                                        </td>
                                        <td>
                                          <div
                                            className={clsx({
                                              small:
                                                parentFeature.valueType ===
                                                "json",
                                            })}
                                          >
                                            <ValueDisplay
                                              value={getFeatureDefaultValue(
                                                parentFeature
                                              )}
                                              type={parentFeature.valueType}
                                              full={false}
                                            />
                                          </div>
                                        </td>
                                        <td>
                                          <div className="d-flex small">
                                            {environments.map((env) => (
                                              <div
                                                key={env.id}
                                                className="mr-3"
                                              >
                                                <div className="font-weight-bold">
                                                  {env.id}
                                                </div>
                                                <div>
                                                  {parentFeature
                                                    ?.environmentSettings?.[
                                                    env.id
                                                  ]?.enabled ? (
                                                    <span className="text-success font-weight-bold uppercase-title">
                                                      ON
                                                    </span>
                                                  ) : (
                                                    <span className="text-danger font-weight-bold uppercase-title">
                                                      OFF
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        </td>
                                      </tr>
                                    </tbody>
                                  </table>
                                }
                              >
                                about
                                <FaInfoCircle className="ml-1" />
                              </Tooltip>
                            </div>
                            <a
                              className="a nowrap"
                              href={`/features/${parentFeatureId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              link
                              <FaExternalLinkAlt className="ml-1" />
                            </a>
                          </div>
                        ) : null}
                      </div>

                      <div className="col">
                        {parentFeature ? (
                          <PrerequisiteInput
                            defaultValue={v.parentCondition}
                            onChange={(s) => {
                              setValue([
                                ...value.slice(0, i),
                                {
                                  parentId: v.parentId,
                                  parentCondition: s,
                                },
                                ...value.slice(i + 1),
                              ]);
                            }}
                            parentFeature={parentFeature}
                            showPassIfLabel={false}
                            key={conditionKeys[i]}
                          />
                        ) : null}
                      </div>

                      <div className="col-md-auto col-sm-12">
                        <button
                          className="btn btn-link text-danger"
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
                    parentId: "",
                    parentCondition: "",
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
                    parentId: "",
                    parentCondition: "{}",
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
