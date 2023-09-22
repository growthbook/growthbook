import React, { Fragment, useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { SampleUsersInterface } from "back-end/types/sample-users";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import SampleUserAttributesModal from "@/components/Attributes/SampleUserAttributesModal";
import useApi from "@/hooks/useApi";
import SampleUsersResults from "@/components/Attributes/SampleUsersResults";
import AttributeForm from "@/components/Attributes/AttributeForm";
import styles from "./AssignmentTester.module.scss";

export interface Props {
  feature: FeatureInterface;
}

export default function AssignmentTester({ feature }: Props) {
  const [open, setOpen] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [results, setResults] = useState<null | FeatureTestResult[]>(null);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const [showSimulateForm, setShowSimulateForm] = useState<boolean | null>(
    null
  );
  const [
    openSampleUserModal,
    setOpenSampleUserModal,
  ] = useState<null | Partial<SampleUsersInterface>>(null);

  const { apiCall } = useAuth();

  const { data, error, mutate } = useApi<{
    status: number;
    sampleUsers: SampleUsersInterface[];
    featureResults: Record<string, FeatureTestResult[]>;
  }>(`/sample-users/eval/${feature.id}`);

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

  if (!data?.sampleUsers) return null;

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
                <div className="px-3 pb-1">
                  <div className="row align-items-top pt-3">
                    <div className="col-auto">
                      <span className="text-muted">Value served:</span>
                    </div>
                    {tr?.result?.value !== undefined ? (
                      <div className="col">
                        <ValueDisplay
                          value={tr.result.value}
                          type={feature.valueType}
                        />
                      </div>
                    ) : (
                      <strong>null</strong>
                    )}
                  </div>
                </div>
                {!tr?.enabled && (
                  <div className="px-3 pb-3">
                    <strong className="text-muted">Feature disabled</strong>
                  </div>
                )}
                {tr?.result && (
                  <>
                    <div className="px-3 pb-3">
                      <span className="mr-2 text-muted">Matched rule: </span>
                      <strong>{matchedRuleName}</strong>
                    </div>
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
                        {tr?.log && (
                          <div className="">
                            <h5>Log</h5>
                            <Code
                              language="json"
                              code={JSON.stringify(tr.log, null, 2)}
                            />
                          </div>
                        )}
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

  if (!data) {
    return <div>Loading...</div>;
  }
  if (error) {
    console.error(error);
    return null;
  }
  return (
    <>
      <div className="appbox mb-4 p-3">
        <div
          className="d-flex flex-row align-items-center justify-content-between cursor-pointer"
          onClick={() => setOpen(!open)}
        >
          <div>
            {open ? (
              <></>
            ) : (
              <>
                Simulate how your rules will apply to users.{" "}
                <Tooltip body="Enter attributes, like are set by your app via the SDK, and see how Growthbook would evaluate this feature for the different environments. Will use draft rules."></Tooltip>
              </>
            )}
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
          <>
            <div>
              <SampleUsersResults
                feature={feature}
                sampleUsers={data.sampleUsers}
                featureResults={data.featureResults}
                onChange={async () => {
                  await mutate();
                }}
              />
            </div>

            <div className="row mt-4">
              <div className="col-12">
                <div className="appbox bg-light p-3">
                  <div
                    className="d-flex flex-row align-items-center justify-content-between cursor-pointer"
                    onClick={() => {
                      if (data?.sampleUsers.length > 0) {
                        setShowSimulateForm(!showSimulateForm);
                      }
                    }}
                  >
                    <div>
                      Simulate how your rules will apply to users.{" "}
                      <Tooltip body="Enter attributes, like are set by your app via the SDK, and see how Growthbook would evaluate this feature for the different environments. Will use draft rules."></Tooltip>
                    </div>
                    {data?.sampleUsers.length > 0 && (
                      <div className="cursor-pointer">
                        <FaChevronRight
                          style={{
                            transform: `rotate(${
                              (showSimulateForm === null &&
                                !data?.sampleUsers.length) ||
                              showSimulateForm === true
                                ? "90deg"
                                : "0deg"
                            })`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {((showSimulateForm === null && !data?.sampleUsers.length) ||
                    showSimulateForm === true) && (
                    <div>
                      {" "}
                      <hr />
                      <div className="row">
                        <div className="col-6">
                          <AttributeForm
                            onChange={(attrs) => {
                              setFormValues(attrs);
                            }}
                          />
                          <div className="mt-2">
                            <a
                              onClick={(e) => {
                                e.preventDefault();
                                setOpenSampleUserModal({
                                  attributes: formValues,
                                });
                              }}
                              href="#"
                              className="btn btn-outline-primary"
                            >
                              Save as Sample User
                            </a>
                          </div>
                        </div>
                        <div
                          className="mb-2 col-6"
                          style={{ paddingTop: "32px" }}
                        >
                          <h4>Results</h4>
                          {showResults()}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <></>
        )}
      </div>
      {openSampleUserModal && (
        <SampleUserAttributesModal
          close={async () => {
            await mutate();
            setOpenSampleUserModal(null);
          }}
          initialValues={openSampleUserModal}
          header="Save Sample User"
        />
      )}
    </>
  );
}
