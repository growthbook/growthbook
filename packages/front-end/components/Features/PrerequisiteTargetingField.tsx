import { FeatureInterface, FeaturePrerequisite } from "back-end/types/feature";
import { FaExternalLinkAlt } from "react-icons/fa";
import clsx from "clsx";
import React from "react";
import ValueDisplay from "@/components/Features/ValueDisplay";
import {
  getFeatureDefaultValue,
  useEnvironments,
  useFeaturesList,
} from "@/services/features";
import PrerequisiteInput from "@/components/Features/PrerequisiteInput";
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

  return (
    <div className="form-group">
      <label>Target by Prerequisite Features</label>
      <div className="border bg-light p-3 mb-1">
        {value.length > 0 ? (
          <div>
            {value.map((v, i) => {
              const parentFeature = features.find((f) => f.id === v.parentId);
              const parentFeatureId = parentFeature?.id;

              return (
                <div className="appbox" key={i}>
                  <div className="row mt-2 mb-3">
                    <div className="col-4">
                      <SelectField
                        label="Prerequisite feature"
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
                          // form.setValue("parentId", v);
                          // form.setValue("parentCondition", "");
                        }}
                        key={`parentId-${i}`}
                        sort={false}
                      />
                    </div>

                    {parentFeature ? (
                      <div className="col pl-4">
                        <div className="border rounded px-3 pt-1 bg-light">
                          <table className="table table-sm mb-0">
                            <thead className="uppercase-title text-muted">
                              <tr>
                                <th className="border-top-0">Feature Key</th>
                                <th className="border-top-0">Type</th>
                                <th className="border-top-0">Default value</th>
                                <th className="border-top-0">Environments</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr>
                                <td>
                                  <a
                                    href={`/features/${parentFeatureId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {parentFeatureId}
                                    <FaExternalLinkAlt className="ml-1" />
                                  </a>
                                </td>
                                <td>{parentFeature.valueType}</td>
                                <td>
                                  <div
                                    className={clsx({
                                      small: parentFeature.valueType === "json",
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
                                      <div key={env.id} className="mr-3">
                                        <div className="font-weight-bold">
                                          {env.id}
                                        </div>
                                        <div>
                                          {parentFeature?.environmentSettings?.[
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
                        </div>
                      </div>
                    ) : null}
                  </div>

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
                      // key={conditionKey}
                    />
                  ) : null}
                </div>
              );
            })}
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
          </div>
        ) : (
          <div>
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
