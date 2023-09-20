import React, { useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { SDKAttribute } from "back-end/types/organization";
import { useForm } from "react-hook-form";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import Field from "@/components/Forms/Field";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import TabButton from "@/components/Tabs/TabButton";
import TabButtons from "@/components/Tabs/TabButtons";
import SelectField from "@/components/Forms/SelectField";
import Toggle from "../Forms/Toggle";
import styles from "./AssignmentTester.module.scss";

export interface Props {
  feature: FeatureInterface;
}

export default function AssignmentTester({ feature }: Props) {
  const [open, setOpen] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [jsonAttributes, setJsonAttributes] = useState<string>(
    JSON.stringify(formValues)
  );
  const [jsonErrors, setJsonErrors] = useState<string | null>();
  const [tab, setTab] = useState<"simple" | "adv">("simple");
  const [results, setResults] = useState<null | FeatureTestResult[]>(null);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const { apiCall } = useAuth();
  //const permissions = usePermissions();

  const attributeSchema = useAttributeSchema(true);

  const orderedAttributes = useMemo(
    () => [
      ...attributeSchema.filter((o) => !o.archived),
      ...attributeSchema.filter((o) => o.archived),
    ],
    [attributeSchema]
  );

  const attributesMap = new Map();
  const defaultValues = orderedAttributes
    .filter((o) => !o.archived)
    .reduce((list, attr) => {
      attributesMap.set(attr.property, attr);
      const defaultValue = attr.datatype === "boolean" ? false : undefined;
      return { ...list, [attr.property]: defaultValue };
    }, {});

  // eslint-disable-next-line
  const attributeForm = useForm<any>({
    defaultValues: defaultValues,
  });

  // filter out empty values (for strings, at least)
  const updateFormValues = (skipJsonUpdate = false) => {
    const filteredValues = Object.entries(attributeForm.getValues())
      .filter(([key, value]) => {
        if (
          attributesMap.get(key)?.datatype === "string" ||
          attributesMap.get(key)?.datatype === "number"
        ) {
          return value !== "";
        } else {
          return true;
        }
      })
      .reduce((obj, [key, value]) => {
        return { ...obj, [key]: value };
      }, {});
    setFormValues(filteredValues ?? {});
    if (!skipJsonUpdate)
      setJsonAttributes(JSON.stringify(filteredValues, null, 2));
  };

  useEffect(() => {
    apiCall<{
      results: FeatureTestResult[];
    }>(`/feature/${feature.id}/eval`, {
      method: "POST",
      body: JSON.stringify({ attributes: formValues }),
    })
      .then((data) => {
        setResults(data.results);
      })
      .catch((e) => console.error(e));
  }, [formValues, apiCall, feature.id]);

  const showResults = () => {
    if (!results) {
      return <div>Add attributes to see results</div>;
    }

    return (
      <div className="row">
        {results.map((tr, i) => {
          let matchedRule;
          if (tr?.result?.ruleId && tr?.featureDefinition?.rules) {
            matchedRule = tr.featureDefinition.rules.find(
              (r) => r.id === tr?.result?.ruleId
            );
          }
          let matchedRuleName = "";
          if (tr?.result?.source === "experiment") {
            const expName =
              tr.result?.experimentResult?.name ||
              tr?.result?.experiment?.key ||
              null;
            matchedRuleName =
              "Experiment" + (expName ? " (" + expName + ")" : "");
          } else if (tr?.result?.source === "force") {
            matchedRuleName = "Forced";
            if (matchedRule && matchedRule?.coverage) {
              matchedRuleName =
                "Rollout (" + matchedRule?.coverage * 100 + "%)";
            }
          } else if (tr?.result?.source === "defaultValue") {
            matchedRuleName = "None - Returned Default Value";
          }

          return (
            <div className={`col-12`} key={i}>
              <div
                className={`appbox ${styles.resultsBox} ${
                  tr?.enabled ? "" : styles.disabledResult
                }`}
              >
                <div className={`${styles.resultsHeader} border-bottom`}>
                  <span className="small text-muted">Environment: </span>
                  <strong>{tr.env}</strong>
                </div>
                <div className="p-3">
                  {tr.enabled ? (
                    <table className={styles.resultsTable}>
                      <thead>
                        <tr>
                          <th>Matched rule</th>
                          <th>Value served</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{matchedRuleName}</td>
                          <td>
                            <ValueDisplay
                              value={tr?.result?.value ?? "null"}
                              type={feature.valueType}
                            />
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center">
                      Feature disabled for this environment
                    </div>
                  )}
                </div>
                {/*<div className="row align-items-top px-3 pt-3">*/}
                {/*  <div className="col-auto">*/}
                {/*    <span>Value served:</span>*/}
                {/*  </div>*/}
                {/*  {tr?.result?.value !== undefined ? (*/}
                {/*    <div className="col">*/}
                {/*      <ValueDisplay*/}
                {/*        value={tr.result.value}*/}
                {/*        type={feature.valueType}*/}
                {/*      />*/}
                {/*    </div>*/}
                {/*  ) : (*/}
                {/*    <strong>null</strong>*/}
                {/*  )}*/}
                {/*</div>*/}
                {/*{!tr?.enabled && (*/}
                {/*  <div className="px-3 pb-3">*/}
                {/*    <strong className="text-muted">Feature disabled</strong>*/}
                {/*  </div>*/}
                {/*)}*/}
                {tr?.result && (
                  <>
                    {/*<div className="px-3 pb-3">*/}
                    {/*  <span>Matched rule: </span>*/}
                    {/*  <strong>{matchedRuleName}</strong>*/}
                    {/*</div>*/}
                    <div
                      className="d-flex flex-row align-items-center justify-content-center align-content-center cursor-pointer"
                      onClick={() => {
                        if (expandResults.includes(i)) {
                          setExpandResults(
                            expandResults.filter((o) => o !== i)
                          );
                        } else {
                          setExpandResults([...expandResults, i]);
                        }
                      }}
                    >
                      <div className={styles.resultsExpand}>
                        <FaChevronRight
                          style={{
                            transform: `rotate(${
                              expandResults.includes(i) ? "270deg" : "90deg"
                            })`,
                          }}
                        />
                      </div>
                    </div>
                    {expandResults.includes(i) && (
                      <div className="p-3">
                        {tr?.result?.experimentResult && (
                          <div>
                            <h5>Experiment result</h5>
                            <Code
                              language="json"
                              code={JSON.stringify(
                                tr.result.experimentResult,
                                null,
                                2
                              )}
                            />
                          </div>
                        )}
                        {tr?.result?.ruleId && (
                          <div>
                            <h5>Matched Rule</h5>
                            <Code
                              language="json"
                              code={JSON.stringify(matchedRule, null, 2)}
                            />
                          </div>
                        )}
                        <div>
                          <h5>Feature value</h5>
                          <Code
                            language="json"
                            code={JSON.stringify(
                              tr?.featureDefinition,
                              null,
                              2
                            )}
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  const attributeInput = (attribute: SDKAttribute, i: number) => {
    if (attribute.archived) return null;
    return (
      <div className="" key={i}>
        <div
          className={`d-flex flex-row align-items-center justify-content-between p-1`}
        >
          <div className="col-6">{attribute.property}</div>
          <div className="col-6">
            {attribute.datatype === "boolean" ? (
              <Toggle
                id={attribute.property}
                value={!!attributeForm.watch(attribute.property)}
                setValue={(value) => {
                  attributeForm.setValue(attribute.property, value);
                }}
              />
            ) : attribute.datatype === "enum" ? (
              <SelectField
                value={attributeForm.watch(attribute.property)}
                onChange={(v) => {
                  // on change here does not trigger the form to change
                  attributeForm.setValue(attribute.property, v);
                  updateFormValues();
                }}
                placeholder="Select..."
                options={
                  attribute?.enum?.split(",").map((d) => ({
                    value: d.trim(),
                    label: d.trim(),
                  })) ?? []
                }
                className=""
              />
            ) : (
              <Field
                className=""
                {...attributeForm.register(attribute.property)}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="appbox mb-4 p-3">
        <div
          className="d-flex flex-row align-items-center justify-content-between cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div>
            Simulate how your rules will apply to users.{" "}
            <Tooltip body="Enter attributes, like are set by your app via the SDK, and see how Growthbook would evaluate this feature for the different environments. Will use draft rules."></Tooltip>
          </div>
          <div className="cursor-pointer" onClick={() => setOpen(!open)}>
            <FaChevronRight
              style={{
                transform: `rotate(${open ? "90deg" : "0deg"})`,
              }}
            />
          </div>
        </div>
        {open ? (
          <div className="row mt-2">
            <div className="col-12">
              <div className="appbox bg-light p-3">
                <div className="row">
                  <div className="col-6">
                    <h4>Attributes</h4>
                    <TabButtons className="mb-0 pb-0">
                      <TabButton
                        active={tab === "simple"}
                        display={<>Form</>}
                        anchor="simple"
                        onClick={() => {
                          setTab("simple");
                          updateFormValues(true);
                        }}
                        newStyle={false}
                        activeClassName="active-tab"
                      />
                      <TabButton
                        active={tab === "adv"}
                        display={<>JSON</>}
                        anchor="adv"
                        onClick={() => {
                          setTab("adv");
                          try {
                            const parsed = JSON.parse(jsonAttributes);
                            setFormValues(parsed);
                          } catch (e) {
                            setJsonErrors(e.message);
                          }
                        }}
                        newStyle={false}
                        activeClassName="active-tab"
                        last={false}
                      />
                    </TabButtons>

                    <div
                      className={`border border-secondary rounded ${styles.attributeBox} pb-2`}
                    >
                      {tab === "simple" ? (
                        <form
                          className=" form-group rounded"
                          onChange={() => {
                            updateFormValues();
                          }}
                        >
                          <div
                            className={`${styles.attrHeader} d-flex flex-row align-items-center justify-content-between small border-bottom p-1 mb-2 sticky-top`}
                          >
                            <div className="col-6">
                              <strong>Name</strong>
                            </div>
                            <div className="col-6">
                              <strong>Value</strong>
                            </div>
                          </div>
                          {orderedAttributes.length ? (
                            orderedAttributes.map((attribute, i) =>
                              attributeInput(attribute, i)
                            )
                          ) : (
                            <>No attributes defined yet</>
                          )}
                        </form>
                      ) : (
                        <div className="p-2">
                          <form
                            className=" form-group rounded"
                            onSubmit={() => {
                              try {
                                const parsed = JSON.parse(jsonAttributes);
                                setFormValues(parsed);
                              } catch (e) {
                                setJsonErrors(e.message);
                              }
                            }}
                          >
                            <Field
                              label={`JSON Values`}
                              value={jsonAttributes}
                              onChange={(e) => {
                                setJsonAttributes(e.target.value);
                                setJsonErrors(null);
                              }}
                              onBlur={(e) => {
                                try {
                                  const parsed = JSON.parse(e.target.value);
                                  setFormValues(parsed);
                                } catch (e) {
                                  setJsonErrors(e.message);
                                }
                              }}
                              textarea={true}
                              minRows={30}
                              containerClassName="mb-0"
                              helpText={`Enter user attributes in JSON format.`}
                            />
                            {jsonErrors && (
                              <div className="text-danger">
                                Error parsing JSON: {jsonErrors}
                              </div>
                            )}
                            <div className="text-right">
                              <button type="submit" className="btn btn-primary">
                                Test Attributes
                              </button>
                            </div>
                          </form>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mb-2 col-6">
                    <h4>Results</h4>
                    {showResults()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </>
  );
}
