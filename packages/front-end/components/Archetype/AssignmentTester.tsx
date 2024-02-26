import React, { useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { useForm } from "react-hook-form";
import { ArchetypeInterface } from "back-end/types/archetype";
import { FiAlertTriangle } from "react-icons/fi";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import ArchetypeResults from "@/components/Archetype/ArchetypeResults";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { NewBucketingSDKList } from "@/components/Experiment/HashVersionSelector";
import Toggle from "@/components/Forms/Toggle";
import { useIncrementer } from "@/hooks/useIncrementer";
import styles from "./AssignmentTester.module.scss";

export interface Props {
  feature: FeatureInterface;
  version: number;
}

export default function AssignmentTester({ feature, version }: Props) {
  const [open, setOpen] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [data, setData] = useState<{
    status: number;
    archetype: ArchetypeInterface[];
    featureResults: Record<string, FeatureTestResult[]>;
  } | null>(null);
  const [results, setResults] = useState<null | FeatureTestResult[]>(null);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const [
    openArchetypeModal,
    setOpenArchetypeModal,
  ] = useState<null | Partial<ArchetypeInterface>>(null);
  const [skipRulesWithPrerequisites, setSkipRulesWithPrerequisites] = useState(
    false
  );

  const hasPrerequisites = useMemo(() => {
    if (feature?.prerequisites?.length) return true;
    if (
      Object.values(feature?.environmentSettings ?? {}).some((env) =>
        env?.rules?.some((rule) => !!rule?.prerequisites?.length)
      )
    )
      return true;
    return false;
  }, [feature]);

  const [archetypeKey, forceArchetypeRerender] = useIncrementer();
  const { apiCall } = useAuth();

  useEffect(() => {
    apiCall<{
      status: number;
      archetype: ArchetypeInterface[];
      featureResults: Record<string, FeatureTestResult[]>;
    }>(
      `/archetype/eval/${feature.id}/${version}?skipRulesWithPrerequisites=${
        skipRulesWithPrerequisites ? 1 : 0
      }`
    )
      .then((data) => {
        setData(data);
      })
      .catch((e) => console.error(e));
  }, [formValues, apiCall, feature, version, skipRulesWithPrerequisites]);

  const { hasCommercialFeature } = useUser();
  const hasArchetypeAccess = hasCommercialFeature("archetypes");

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
    }>(`/feature/${feature.id}/${version}/eval`, {
      method: "POST",
      body: JSON.stringify({
        attributes: formValues,
        skipRulesWithPrerequisites,
      }),
    })
      .then((data) => {
        setResults(data.results);
      })
      .catch((e) => console.error(e));
  }, [formValues, apiCall, feature, version, skipRulesWithPrerequisites]);

  const showResults = () => {
    if (!results) {
      return <div>Add attributes to see results</div>;
    }

    return (
      <div className="row">
        {results.map((tr, i) => {
          let matchedRule;
          const debugLog: string[] = [];
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
          if (tr?.log) {
            tr.log.forEach((log, n) => {
              const reason = log[0];
              if (reason === "Skip rule because of condition") {
                debugLog.push(
                  `Rule ${
                    n + 1
                  }: Skipped because user did not match the rule conditions`
                );
              } else if (reason === "In experiment") {
                debugLog.push(
                  `Rule ${n + 1}: Included user in experiment rule`
                );
              } else if (reason === "Use default value") {
                debugLog.push(`No rules matched, using default value`);
              } else {
                debugLog.push(`Rule ${n + 1}: ${log[0]}`);
              }
            });
          }

          return (
            <div className={`col-12`} key={i}>
              <div
                className={`appbox bg-light ${styles.resultsBox} ${
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
                          value={
                            typeof tr.result.value === "string"
                              ? tr.result.value
                              : JSON.stringify(tr.result.value)
                          }
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
                        {debugLog && (
                          <div className="mb-3">
                            <h5>Log</h5>
                            <div className="bg-white border border-light rounded p-3">
                              {debugLog.map((log, i) => (
                                <div className="row my-2" key={i}>
                                  <div className="col">{log}</div>
                                </div>
                              ))}
                            </div>
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

  return (
    <>
      {hasPrerequisites && (
        <div
          className="d-flex justify-content-end position-relative mb-2"
          style={{ marginTop: -30, zIndex: 1 }}
        >
          <div>
            <div className="text-gray">
              <span className="font-weight-bold">Prereq evaluation:</span>{" "}
              <span>
                Top-level: <span className="text-success">pass</span>.
              </span>{" "}
              <span>
                Override rules:{" "}
                {skipRulesWithPrerequisites ? (
                  <span className="text-danger">fail</span>
                ) : (
                  <span className="text-success">pass</span>
                )}
                .
              </span>
            </div>
            <div className="d-flex mt-1 align-items-center">
              <div className="flex-1" />
              <label
                className="mb-1 mr-2 small"
                htmlFor="skipRulesWithPrerequisites"
              >
                Skip rules with prerequisite targeting
              </label>
              <Toggle
                id="skipRulesWithPrerequisites"
                value={skipRulesWithPrerequisites}
                setValue={(v) => setSkipRulesWithPrerequisites(v)}
              />
            </div>
          </div>
        </div>
      )}

      <div>
        {data && data?.archetype.length > 0 && (
          <ArchetypeResults
            feature={feature}
            archetype={data.archetype}
            featureResults={data.featureResults}
            onChange={forceArchetypeRerender}
            key={archetypeKey}
          />
        )}
      </div>

      <div className="appbox p-3">
        <div
          className="d-flex flex-row align-items-center justify-content-between cursor-pointer"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <div>
            Simulate how your rules will apply to users.{" "}
            <Tooltip body="Enter attributes and see how Growthbook would evaluate this feature for the different environments. Will use draft rules."></Tooltip>
          </div>

          <div className="cursor-pointer">
            <FaChevronRight
              style={{
                transform: `rotate(${open ? "90deg" : "0deg"})`,
              }}
            />
          </div>
        </div>
        {open && (
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
                  <PremiumTooltip commercialFeature="archetypes">
                    <a
                      onClick={(e) => {
                        e.preventDefault();
                        setOpenArchetypeModal({
                          attributes: JSON.stringify(formValues),
                        });
                      }}
                      href="#"
                      className="btn btn-outline-primary"
                    >
                      Save Archetype
                    </a>
                  </PremiumTooltip>
                </div>
              </div>
              <div className="mb-2 col-6" style={{ paddingTop: "32px" }}>
                <h4>
                  Results{" "}
                  <div className="text-warning float-right">
                    <Tooltip
                      body={
                        <>
                          These results use the JS SDK, which supports the V2
                          hashing algorithm. If you use one of the older or
                          unsupported SDKs, you may want to change the hashing
                          algorithm of the experiment to v1 to ensure accurate
                          results.
                          <br />
                          <br />
                          The following SDK versions support V2 hashing:
                          <NewBucketingSDKList />
                        </>
                      }
                    >
                      <FiAlertTriangle />
                    </Tooltip>
                  </div>
                </h4>
                {showResults()}
              </div>
            </div>
          </div>
        )}
      </div>
      {openArchetypeModal && (
        <>
          {hasArchetypeAccess ? (
            <ArchetypeAttributesModal
              close={async () => {
                forceArchetypeRerender();
                setOpenArchetypeModal(null);
              }}
              initialValues={openArchetypeModal}
              header="Save Archetype"
            />
          ) : (
            <Modal open={true} close={() => setOpenArchetypeModal(null)}>
              <div className="p-3">
                Archetypes allow you set up user attribute traits to test how
                feature will be applied to your real users. This feature is part
                of our Pro or Enterprise plans.
              </div>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
