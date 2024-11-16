/* eslint-disable react-hooks/exhaustive-deps */

import React, { useState, useEffect } from "react";
import { some } from "lodash";
import {
  FaExclamationCircle,
  FaMinusCircle,
  FaPlusCircle,
} from "react-icons/fa";
import { RxLoop } from "react-icons/rx";
import clsx from "clsx";
import {
  condToJson,
  jsonToConds,
  useAttributeMap,
  useAttributeSchema,
  getDefaultOperator,
} from "@/services/features";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import CodeTextArea from "@/components/Forms/CodeTextArea";
import StringArrayField from "@/components/Forms/StringArrayField";
import CountrySelector, {
  ALL_COUNTRY_CODES,
} from "@/components/Forms/CountrySelector";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import styles from "./ConditionInput.module.scss";

interface Props {
  defaultValue: string;
  onChange: (value: string) => void;
  project: string;
  labelClassName?: string;
  emptyText?: string;
  title?: string;
  require?: boolean;
}
export default function ConditionInput(props: Props) {
  const { savedGroups } = useDefinitions();

  const attributes = useAttributeMap(props.project);

  const title = props.title || "按属性进行目标定位";
  const emptyText = props.emptyText || "默认应用于所有人。";

  const [advanced, setAdvanced] = useState(
    () => jsonToConds(props.defaultValue, attributes) === null
  );
  const [simpleAllowed, setSimpleAllowed] = useState(false);
  const [value, setValue] = useState(props.defaultValue);
  const [conds, setConds] = useState(
    () => jsonToConds(props.defaultValue, attributes) || []
  );
  const [rawTextMode, setRawTextMode] = useState(false);

  const attributeSchema = useAttributeSchema(false, props.project);

  useEffect(() => {
    if (advanced) return;
    setValue(condToJson(conds, attributes));
  }, [advanced, conds]);

  useEffect(() => {
    props.onChange(value);
    setSimpleAllowed(jsonToConds(value, attributes) !== null);
  }, [value, attributes]);

  const savedGroupOperators = [
    {
      label: "在已保存的分组中",
      value: "$inGroup",
    },
    {
      label: "不在已保存的分组中",
      value: "$notInGroup",
    },
  ];

  const listOperators = ["$in", "$nin"];

  if (advanced || !attributes.size || !simpleAllowed) {
    const hasSecureAttributes = some(
      [...attributes].filter(([_, a]) =>
        ["secureString", "secureString[]"].includes(a.datatype)
      )
    );
    return (
      <div className="form-group my-4">
        <label className={props.labelClassName || ""}>{title}</label>
        <div className="appbox bg-light px-3 py-3">
          <CodeTextArea
            labelClassName={props.labelClassName}
            language="json"
            value={value}
            setValue={setValue}
            helpText={
              <>
                <div className="d-flex">
                  <div>使用MongoDB查询语法的JSON格式。</div>
                  {simpleAllowed && attributes.size && (
                    <div className="ml-auto">
                      <span
                        className="link-purple cursor-pointer"
                        onClick={(e) => {
                          e.preventDefault();
                          const newConds = jsonToConds(value, attributes);
                          // TODO: 显示错误
                          if (newConds === null) return;
                          setConds(newConds);
                          setAdvanced(false);
                        }}
                      >
                        <RxLoop /> 简单模式
                      </span>
                    </div>
                  )}
                </div>
                {hasSecureAttributes && (
                  <div className="mt-1 text-warning-orange">
                    <FaExclamationCircle /> 复杂规则下安全属性哈希不一定能保证有效
                  </div>
                )}
              </>
            }
          />
        </div>
      </div>
    );
  }

  if (!conds.length) {
    return (
      <div className="form-group my-4">
        <label className={props.labelClassName || ""}>{title}</label>
        <div>
          <div className="font-italic text-muted mr-3">{emptyText}</div>
          <div
            className="d-inline-block ml-1 mt-2 link-purple font-weight-bold cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              const prop = attributeSchema[0];
              setConds([
                {
                  field: prop?.property || "",
                  operator: prop?.datatype === "boolean" ? "$true" : "$eq",
                  value: "",
                },
              ]);
            }}
          >
            <FaPlusCircle className="mr-1" />
            添加属性目标定位
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-group my-4">
      <label className={props.labelClassName || ""}>{title}</label>
      <div className="appbox bg-light px-3 pb-3">
        <ul className={styles.conditionslist}>
          {conds.map(({ field, operator, value }, i) => {
            const attribute = attributes.get(field);

            if (!attribute) {
              console.error("属性在属性映射中未找到。");
              return;
            }

            const savedGroupOptions = savedGroups
              // 首先，限制为具有正确属性的分组
              .filter((g) => g.type === "list" && g.attributeKey === field)
              // 按项目过滤
              .filter((group) => {
                return (
                  !props.project ||
                  !group.projects?.length ||
                  group.projects.includes(props.project)
                );
              })
              // 然后，转换为选择选项格式
              .map((g) => ({ label: g.groupName, value: g.id }));

            const handleCondsChange = (value: string, name: string) => {
              const newConds = [...conds];
              newConds[i] = { ...newConds[i] };
              newConds[i][name] = value;
              setConds(newConds);
            };

            const handleFieldChange = (
              e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>
            ) => {
              const name = e.target.name;
              const value: string | number = e.target.value;

              handleCondsChange(value, name);
            };

            const handleListChange = (values: string[]) => {
              const name = "value";
              const value: string | number = values.join(",");
              handleCondsChange(value, name);
            };

            const operatorOptions =
              attribute.datatype === "boolean"
                ? [
                  {
                    label: "为真",
                    value: "$true"
                  },
                  {
                    label: "为假",
                    value: "$false"
                  },
                  {
                    label: "不为空",
                    value: "$exists"
                  },
                  {
                    label: "为空",
                    value: "$notExists"
                  },
                ] : attribute.array
                  ? [
                    {
                      label: "包含",
                      value: "$includes"
                    },
                    {
                      label: "不包含",
                      value: "$notIncludes"
                    },
                    {
                      label: "为空",
                      value: "$empty"
                    },
                    {
                      label: "不为空",
                      value: "$notEmpty"
                    },
                    {
                      label: "不为空",
                      value: "$exists"
                    },
                    {
                      label: "为空",
                      value: "$notExists"
                    },
                  ]
                  : attribute.enum?.length || 0 > 0
                    ? [
                      {
                        label: "等于",
                        value: "$eq"
                      },
                      {
                        label: "不等于",
                        value: "$ne"
                      },
                      {
                        label: "在列表中",
                        value: "$in"
                      },
                      {
                        label: "不在列表中",
                        value: "$nin"
                      },
                      {
                        label: "不为空",
                        value: "$exists"
                      },
                      {
                        label: "为空",
                        value: "$notExists"
                      },
                    ]
                    : attribute.datatype === "string"
                      ? [
                        {
                          label: "等于",
                          value: attribute.format === "version" ? "$veq" : "$eq",
                        },
                        {
                          label: "不等于",
                          value: attribute.format === "version" ? "$vne" : "$ne",
                        },
                        {
                          label: "匹配正则表达式",
                          value: "$regex"
                        },
                        {
                          label: "不匹配正则表达式",
                          value: "$notRegex"
                        },
                        {
                          label:
                            attribute.format === "date"
                              ? "在之后"
                              : "大于",
                          value: attribute.format === "version" ? "$vgt" : "$gt",
                        },
                        {
                          label:
                            attribute.format === "date"
                              ? "在之后或等于"
                              : "大于或等于",
                          value: attribute.format === "version" ? "$vgte" : "$gte",
                        },
                        {
                          label:
                            attribute.format === "date"
                              ? "在之前"
                              : "小于",
                          value: attribute.format === "version" ? "$vlt" : "$lt",
                        },
                        {
                          label:
                            attribute.format === "date"
                              ? "在之前或等于"
                              : "小于或等于",
                          value: attribute.format === "version" ? "$vlte" : "$lte",
                        },
                        {
                          label: "在列表中",
                          value: "$in"
                        },
                        {
                          label: "不在列表中",
                          value: "$nin"
                        },
                        {
                          label: "不为空",
                          value: "$exists"
                        },
                        {
                          label: "为空",
                          value: "$notExists"
                        },
                        ...(savedGroupOptions.length > 0
                          ? savedGroupOperators
                          : []),
                      ]
                      : attribute.datatype === "secureString"
                        ? [
                          {
                            label: "等于",
                            value: "$eq"
                          },
                          {
                            label: "不等于",
                            value: "$ne"
                          },
                          {
                            label: "在列表中",
                            value: "$in"
                          },
                          {
                            label: "不在列表中",
                            value: "$nin"
                          },
                          {
                            label: "不为空",
                            value: "$exists"
                          },
                          {
                            label: "为空",
                            value: "$notExists"
                          },
                          ...(savedGroupOptions.length > 0
                            ? savedGroupOperators
                            : []),
                        ]
                        : attribute.datatype === "number"
                          ? [
                            {
                              label: "等于",
                              value: "$eq"
                            },
                            {
                              label: "不等于",
                              value: "$ne"
                            },
                            {
                              label: "大于",
                              value: "$gt"
                            },
                            {
                              label: "大于或等于",
                              value: "$gte"
                            },
                            {
                              label: "小于",
                              value: "$lt"
                            },
                            {
                              label: "小于或等于",
                              value: "$lte"
                            },
                            {
                              label: "在列表中",
                              value: "$in"
                            },
                            {
                              label: "不在列表中",
                              value: "$nin"
                            },
                            {
                              label: "不为空",
                              value: "$exists"
                            },
                            {
                              label: "为空",
                              value: "$notExists"
                            },
                            ...(savedGroupOptions.length > 0
                              ? savedGroupOperators
                              : []),
                          ]
                          : [];

            let displayType:
              | "select-only"
              | "array-field"
              | "enum"
              | "number"
              | "string"
              | "isoCountryCode"
              | null = null;
            if (
              [
                "$exists",
                "$notExists",
                "$true",
                "$false",
                "$empty",
                "$notEmpty",
              ].includes(operator)
            ) {
              displayType = "select-only";
            } else if (attribute.enum === ALL_COUNTRY_CODES) {
              displayType = "isoCountryCode";
            } else if (attribute.enum.length) {
              displayType = "enum";
            } else if (listOperators.includes(operator)) {
              displayType = "array-field";
            } else if (attribute.datatype === "number") {
              displayType = "number";
            } else if (
              ["string", "secureString"].includes(attribute.datatype)
            ) {
              displayType = "string";
            }
            const hasExtraWhitespace =
              displayType === "string" && value !== value.trim();
            return (
              <li key={i} className={styles.listitem}>
                <div className={`row ${styles.listrow}`}>
                  {i > 0 ? (
                    <span className={`${styles.and} mr-2`}>并且</span>
                  ) : (
                    <span className={`${styles.and} mr-2`}>如果</span>
                  )}
                  <div className="col-sm-12 col-md mb-2">
                    <SelectField
                      value={field}
                      options={attributeSchema.map((s) => ({
                        label: s.property,
                        value: s.property,
                        tooltip: s.description || "",
                      }))}
                      formatOptionLabel={(o) => (
                        <span title={o.tooltip}>{o.label}</span>
                      )}
                      name="field"
                      className={styles.firstselect}
                      onChange={(value) => {
                        const newConds = [...conds];
                        newConds[i] = { ...newConds[i] };
                        newConds[i]["field"] = value;

                        const newAttribute = attributes.get(value);
                        const hasAttrChanged =
                          newAttribute?.datatype !== attribute.datatype ||
                          newAttribute?.array !== attribute.array;
                        if (hasAttrChanged && newAttribute) {
                          newConds[i]["operator"] = getDefaultOperator(
                            newAttribute
                          );
                          newConds[i]["value"] = newConds[i]["value"] || "";
                        }
                        setConds(newConds);
                      }}
                    />
                  </div>
                  <div className="col-sm-12 col-md mb-2">
                    <SelectField
                      value={operator}
                      name="operator"
                      options={operatorOptions}
                      sort={false}
                      onChange={(v) => {
                        handleCondsChange(v, "operator");
                      }}
                    />
                  </div>
                  {displayType === "select-only" ? (
                    ""
                  ) : ["$inGroup", "$notInGroup"].includes(operator) &&
                    savedGroupOptions.length > 0 ? (
                    <SelectField
                      options={savedGroupOptions}
                      value={value}
                      onChange={(v) => {
                        handleCondsChange(v, "value");
                      }}
                      name="value"
                      initialOption="选择分组..."
                      containerClassName="col-sm-12 col-md mb-2"
                      required
                    />
                  ) : displayType === "array-field" ? (
                    <div className="d-flex align-items-end flex-column col-sm-12 col-md mb-1">
                      {rawTextMode ? (
                        <Field
                          textarea
                          value={value}
                          onChange={handleFieldChange}
                          name="value"
                          minRows={1}
                          className={styles.matchingInput}
                          helpText={
                            <span
                              className="position-relative"
                              style={{ top: -5 }}
                            >
                              用逗号分隔值
                            </span>
                          }
                          required
                        />
                      ) : (
                        <StringArrayField
                          containerClassName="w-100"
                          value={value ? value.trim().split(",") : []}
                          onChange={handleListChange}
                          placeholder="输入一些值..."
                          delimiters={["回车", "制表符"]}
                          required
                        />
                      )}
                      <span
                        className="link-purple cursor-pointer"
                        style={{ fontSize: "0.8em" }}
                        onClick={(e) => {
                          e.preventDefault();
                          setRawTextMode((prev) => !prev);
                        }}
                      >
                        切换到{rawTextMode ? "标记" : "纯文本"}模式
                      </span>
                    </div>
                  ) : displayType === "isoCountryCode" ? (
                    listOperators.includes(operator) ? (
                      <CountrySelector
                        selectAmount="多选"
                        displayFlags={true}
                        value={
                          value ? value.split(",").map((val) => val.trim()) : []
                        }
                        onChange={handleListChange}
                      />
                    ) : (
                      <CountrySelector
                        selectAmount="单选"
                        displayFlags={true}
                        value={value}
                        onChange={(v) => {
                          handleCondsChange(v, "value");
                        }}
                      />
                    )
                  ) : displayType === "enum" ? (
                    listOperators.includes(operator) ? (
                      <MultiSelectField
                        options={attribute.enum.map((v) => ({
                          label: v,
                          value: v,
                        }))}
                        value={
                          value ? value.split(",").map((val) => val.trim()) : []
                        }
                        onChange={handleListChange}
                        name="value"
                        containerClassName="col-sm-12 col-md mb-2"
                        required
                      />
                    ) : (
                      <SelectField
                        options={attribute.enum.map((v) => ({
                          label: v,
                          value: v,
                        }))}
                        value={value}
                        onChange={(v) => {
                          handleCondsChange(v, "value");
                        }}
                        name="value"
                        initialOption="选择一个..."
                        containerClassName="col-sm-12 col-md mb-2"
                        required
                      />
                    )
                  ) : displayType === "number" ? (
                    <Field
                      type="number"
                      step="任意"
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      className={styles.matchingInput}
                      containerClassName="col-sm-12 col-md mb-2"
                      required
                    />
                  ) : displayType === "string" ? (
                    <Field
                      type={
                        attribute.format === "date" &&
                          !["$regex", "$notRegex"].includes(operator)
                          ? "datetime-local"
                          : undefined
                      }
                      value={value}
                      onChange={handleFieldChange}
                      name="value"
                      className={styles.matchingInput}
                      containerClassName={clsx("col-sm-12 col-md mb-2", {
                        error: hasExtraWhitespace,
                      })}
                      helpText={
                        hasExtraWhitespace ? (
                          <small className="text-danger">
                            检测到多余空格
                          </small>
                        ) : undefined
                      }
                      required
                    />
                  ) : (
                    ""
                  )}
                  {(conds.length > 1 || !props.require) && (
                    <div className="col-md-auto col-sm-12">
                      <button
                        className="btn btn-link text-danger float-right"
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          const newConds = [...conds];
                          newConds.splice(i, 1);
                          setConds(newConds);
                        }}
                      >
                        <FaMinusCircle className="mr-1" />
                        删除
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="d-flex align-items-center">
          {attributeSchema.length > 0 && (
            <span
              className="link-purple font-weight-bold cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                const prop = attributeSchema[0];
                setConds([
                  ...conds,
                  {
                    field: prop?.property || "",
                    operator: prop?.datatype === "boolean" ? "$true" : "$eq",
                    value: "",
                  },
                ]);
              }}
            >
              <FaPlusCircle className="mr-1" />
              添加另一个条件
            </span>
          )}
          <span
            className="ml-auto link-purple cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              setAdvanced(true);
            }}
          >
            <RxLoop /> 高级模式
          </span>
        </div>
      </div>
    </div>
  );
}