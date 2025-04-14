import React, { useEffect, useMemo, useState } from "react";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { ArchetypeInterface } from "back-end/types/archetype";
import { FiAlertTriangle } from "react-icons/fi";
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
import Toggle from "@/components/Forms/Toggle";
import { useArchetype } from "@/hooks/useArchetype";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";
import styles from "./AssignmentTester.module.scss";

export interface Props {
  feature: FeatureInterface;
  version: number;
  project?: string;
}

export default function AssignmentTester({ feature, version, project }: Props) {
  const [open, setOpen] = useState(false);
  const [formValues, setFormValues] = useState({});
  const [results, setResults] = useState<null | FeatureTestResult[]>(null);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const [
    openArchetypeModal,
    setOpenArchetypeModal,
  ] = useState<null | Partial<ArchetypeInterface>>(null);
  const [skipRulesWithPrerequisites, setSkipRulesWithPrerequisites] = useState(
    false
  );

  const { data, mutate: mutateData } = useArchetype({
    feature,
    version,
    project,
    skipRulesWithPrerequisites,
  });

  const { apiCall } = useAuth();

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
      }),
    })
      .then((data) => {
        setResults(data.results);
      })
      .catch((e) => console.error(e));
  }, [formValues, apiCall, feature, version, skipRulesWithPrerequisites]);

  const showResults = () => {
    if (!results) {
      return <div>添加属性以查看结果</div>;
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
              "实验" + (expName ? " (" + expName + ")" : "");
          } else if (tr?.result?.source === "force") {
            matchedRuleName = "强制";
            if (matchedRule && matchedRule?.coverage) {
              matchedRuleName =
                "推出 (" + matchedRule?.coverage * 100 + "%)";
            }
          } else if (tr?.result?.source === "defaultValue") {
            matchedRuleName = "无 - 返回默认值";
          }
          if (tr?.log) {
            tr.log.forEach((log, n) => {
              const reason = log[0];
              if (reason === "Skip rule because of condition") {
                debugLog.push(
                  `规则 ${n + 1
                  }: 跳过，因为用户不满足规则条件`
                );
              } else if (reason === "In experiment") {
                debugLog.push(
                  `规则 ${n + 1}: 将用户纳入实验规则`
                );
              } else if (reason === "Use default value") {
                debugLog.push(`没有匹配的规则，使用默认值`);
              } else {
                debugLog.push(`规则 ${n + 1}: ${log[0]}`);
              }
            });
          }

          return (
            <div className={`col-12`} key={i}>
              <div
                className={`appbox bg-light ${styles.resultsBox} ${tr?.enabled ? "" : styles.disabledResult
                  }`}
              >
                <div className={`${styles.resultsHeader} border-bottom`}>
                  <span className="small text-muted">环境: </span>
                  <strong>{tr.env}</strong>
                </div>
                <div className="px-3 pb-1">
                  <div className="row align-items-top pt-3">
                    <div className="col-auto">
                      <span className="text-muted">提供的值:</span>
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
                      <strong>空</strong>
                    )}
                  </div>
                </div>
                {!tr?.enabled && (
                  <div className="px-3 pb-3">
                    <strong className="text-muted">Feature已禁用</strong>
                  </div>
                )}
                {tr?.result && (
                  <>
                    <div className="px-3 pb-3">
                      <span className="mr-2 text-muted">匹配的规则: </span>
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
                            transform: `rotate(${expandResults.includes(i) ? "270deg" : "90deg"
                              })`,
                          }}
                        />
                      </div>
                    </div>
                    {expandResults.includes(i) && (
                      <div className="p-3">
                        {debugLog && (
                          <div className="mb-3">
                            <h5>日志</h5>
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
                            <h5>实验结果</h5>
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
                            <h5>匹配的规则</h5>
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
              <span className="font-weight-bold">前置条件评估:</span>{" "}
              <span>
                顶级: <span className="text-success">通过</span>。
              </span>{" "}
              <span>
                规则:{" "}
                {skipRulesWithPrerequisites ? (
                  <span className="text-danger">失败</span>
                ) : (
                  <span className="text-success">通过</span>
                )}
                。
              </span>
            </div>
            <div className="d-flex mt-1 align-items-center">
              <div className="flex-1" />
              <label
                className="mb-1 mr-2 small"
                htmlFor="skipRulesWithPrerequisites"
              >
                跳过带有前置条件定向的规则
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
            onChange={() => mutateData()}
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
            模拟你的规则如何作用于用户.{" "}
            <Tooltip body="输入属性，查看 Growthbook 如何为不同环境评估此功能。将使用草稿规则。"></Tooltip>
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
                      保存原型
                    </a>
                  </PremiumTooltip>
                </div>
              </div>
              <div className="mb-2 col-6" style={{ paddingTop: "32px" }}>
                <h4>
                  结果{" "}
                  <div className="text-warning float-right">
                    <Tooltip
                      body={
                        <>
                          这些结果使用 JS SDK，它支持 V2 哈希算法。如果你使用的是较旧或不支持的 SDK 之一，你可能需要将实验的哈希算法更改为 v1 以确保结果准确。
                          <br />
                          <br />
                          以下 SDK 版本支持 V2 哈希：
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
      </div>
      {openArchetypeModal && (
        <>
          {hasArchetypeAccess ? (
            <ArchetypeAttributesModal
              close={async () => {
                mutateData();
                setOpenArchetypeModal(null);
              }}
              initialValues={openArchetypeModal}
              header="保存原型"
            />
          ) : (
            <Modal
              trackingEventModalType=""
              open={true}
              close={() => setOpenArchetypeModal(null)}
            >
              <div className="p-3">
                原型允许你设置用户属性特征，以测试功能将如何应用于你的真实用户。此功能是我们专业版或企业版计划的一部分。
              </div>
            </Modal>
          )}
        </>
      )}
    </>
  );
}
