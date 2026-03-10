import React, { useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeatureTestResult } from "shared/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { ArchetypeInterface } from "shared/types/archetype";
import { FiAlertTriangle } from "react-icons/fi";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { MinimalFeatureRevisionInterface } from "shared/types/feature-revision";
import { useAuth } from "@/services/auth";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import ArchetypeResults from "@/components/Archetype/ArchetypeResults";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Modal from "@/components/Modal";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useArchetype } from "@/hooks/useArchetype";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import DatePicker from "@/components/DatePicker";
import Button from "@/ui/Button";
import RevisionDropdown from "@/components/Features/RevisionDropdown";
import Frame from "@/ui/Frame";
import Switch from "@/ui/Switch";
import styles from "./AssignmentTester.module.scss";

export interface Props {
  feature: FeatureInterface;
  version: number;
  project?: string;
  startOpen?: boolean;
  setVersion: (v: number) => void;
  revisions?: MinimalFeatureRevisionInterface[];
  baseFeature: FeatureInterface;
}

export default function AssignmentTester({
  feature,
  version,
  project,
  startOpen = true,
  setVersion,
  revisions,
  baseFeature,
}: Props) {
  const [open, setOpen] = useState(startOpen);
  const [formValues, setFormValues] = useState({});
  const [results, setResults] = useState<null | FeatureTestResult[]>(null);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const [openArchetypeModal, setOpenArchetypeModal] =
    useState<null | Partial<ArchetypeInterface>>(null);
  const [skipRulesWithPrerequisites, setSkipRulesWithPrerequisites] =
    useState(false);
  const [evalDate, setEvalDate] = useState<Date | undefined>(new Date());

  const { data, mutate: mutateData } = useArchetype({
    feature,
    version,
    project,
    skipRulesWithPrerequisites,
  });

  const currentVersion = version || baseFeature.version;
  const { apiCall } = useAuth();

  const hasPrerequisites = useMemo(() => {
    return true;
    if (feature?.prerequisites?.length) return true;
    if (
      Object.values(feature?.environmentSettings ?? {}).some((env) =>
        env?.rules?.some((rule) => !!rule?.prerequisites?.length),
      )
    )
      return true;
    return false;
  }, [feature]);

  const hasScheduled = useMemo(() => {
    return Object.values(feature?.environmentSettings ?? {}).some((env) =>
      env?.rules?.some(
        (rule) =>
          !!rule?.scheduleRules?.length || !!rule?.prerequisites?.length,
      ),
    );
  }, [feature]);
  const { hasCommercialFeature } = useUser();
  const hasArchetypeAccess = hasCommercialFeature("archetypes");

  useEffect(() => {
    apiCall<{
      results: FeatureTestResult[];
    }>(`/feature/${feature.id}/${version}/eval`, {
      method: "POST",
      body: JSON.stringify({
        attributes: formValues,
        skipRulesWithPrerequisites,
        evalDate: evalDate?.toISOString() ?? new Date().toISOString(),
      }),
    })
      .then((data) => {
        setResults(data.results);
      })
      .catch((e) => console.error(e));
  }, [
    formValues,
    apiCall,
    feature,
    version,
    skipRulesWithPrerequisites,
    evalDate,
  ]);

  const evalDateStr = evalDate?.toISOString().split("T")[0] ?? "";
  const isNow = evalDateStr === new Date().toISOString().split("T")[0];

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
              (r) => r.id === tr?.result?.ruleId,
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
                  }: Skipped because user did not match the rule conditions`,
                );
              } else if (reason === "In experiment") {
                debugLog.push(
                  `Rule ${n + 1}: Included user in experiment rule`,
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
                            expandResults.filter((o) => o !== i),
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
                                2,
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
      <Box>
        <Heading mb="1" size="5" as="h2">
          Simulate Feature Rules
        </Heading>
        <Text mb="0">
          Test how your rules will apply to users.{" "}
          <Tooltip body="Enter attributes and see how Growthbook would evaluate this feature for the different environments. Will use draft rules."></Tooltip>
        </Text>
      </Box>
      <Flex align="end" justify="between" mb="5" mt="3">
        <Box width={{ initial: "98%", sm: "70%", md: "60%", lg: "50%" }}>
          <RevisionDropdown
            feature={feature}
            version={currentVersion}
            setVersion={setVersion}
            revisions={revisions || []}
          />
        </Box>
        <Flex align="end" justify="end">
          <Box>
            {hasPrerequisites && (
              <Flex align="center" justify="end" mb="2" gap="3">
                <span className="font-weight-bold">Prereq evaluation:</span>{" "}
                <span>
                  Top-level: <span className="text-success">pass</span>.
                </span>{" "}
                <span>
                  Rules:{" "}
                  {skipRulesWithPrerequisites ? (
                    <span className="text-danger">fail</span>
                  ) : (
                    <span className="text-success">pass</span>
                  )}
                  .
                </span>
              </Flex>
            )}
            <Flex align="center">
              {hasPrerequisites && (
                <>
                  <Switch
                    label="Skip rules with prerequisite targeting"
                    id="skipRulesWithPrerequisites"
                    value={skipRulesWithPrerequisites}
                    onChange={(c) => setSkipRulesWithPrerequisites(c)}
                  />
                </>
              )}
              {hasScheduled && (
                <Box ml="2">
                  <Flex align="center">
                    <label
                      className="small text-muted mr-2 mb-0 small text-muted text-ellipsis"
                      htmlFor="evalDate"
                      title="When there are scheduled rules, this date select lets your see what values the user will get."
                    >
                      Evaluation Date
                    </label>
                    <DatePicker
                      id="evalDate"
                      date={evalDate}
                      setDate={setEvalDate}
                      precision="date"
                      containerClassName="d-flex align-items-end mb-0"
                    />
                  </Flex>
                </Box>
              )}
            </Flex>
          </Box>
        </Flex>
      </Flex>

      <div>
        {data && data?.archetype.length > 0 && (
          <ArchetypeResults
            feature={feature}
            archetype={data.archetype}
            featureResults={data.featureResults}
            onChange={() => mutateData()}
          />
        )}
      </div>

      <Frame>
        <Box>
          <Flex align="center" justify="between">
            <Heading as="h4" size="3" mb="0">
              Ad hoc attributes
            </Heading>
            <Button variant="ghost" onClick={() => setOpen(!open)}>
              <FaChevronRight
                style={{
                  transform: `rotate(${open ? "90deg" : "0deg"})`,
                }}
              />
            </Button>
          </Flex>
          {open && (
            <div>
              <div className="row">
                <div className="col-6">
                  <AttributeForm
                    attributeValues={formValues}
                    onChange={(attrs) => {
                      setFormValues(attrs);
                    }}
                    hideTitle={true}
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
                <div className="mb-2 col-6" style={{ paddingTop: "13px" }}>
                  <h4>
                    Results{isNow ? " " : ` for ${evalDateStr}`}{" "}
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
                            <MinSDKVersionsList capability="bucketingV2" />
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
        </Box>
      </Frame>
      {openArchetypeModal && (
        <>
          {hasArchetypeAccess ? (
            <ArchetypeAttributesModal
              close={async () => {
                mutateData();
                setOpenArchetypeModal(null);
              }}
              initialValues={openArchetypeModal}
              header="Save Archetype"
            />
          ) : (
            <Modal
              trackingEventModalType=""
              open={true}
              close={() => setOpenArchetypeModal(null)}
            >
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
