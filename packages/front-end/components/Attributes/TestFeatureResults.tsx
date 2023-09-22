import React, { FC, useEffect, useState } from "react";
import {
  SampleUserAttributeValues,
  SampleUsersInterface,
} from "back-end/types/sample-users";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { FaChevronRight } from "react-icons/fa";
import { useAuth } from "@/services/auth";
import styles from "@/components/Attributes/TestFeatureResults.module.scss";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Modal from "@/components/Modal";
import SampleUserAttributesModal from "@/components/Attributes/SampleUserAttributesModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";

const TestFeatureResults: FC<{
  user: SampleUsersInterface;
  feature: FeatureInterface;
  initialState: "compact" | "expanded";
  updated?: (user: SampleUsersInterface) => void;
}> = ({ user, feature, initialState = "expanded", updated }) => {
  const { apiCall } = useAuth();
  const [results, setResults] = useState<FeatureTestResult[]>([]);
  const [state, setState] = useState<"compact" | "expanded">(initialState);
  const [expandResults, setExpandResults] = useState<number[]>([]);
  const [
    editSavedUser,
    setEditSavedUser,
  ] = useState<SampleUsersInterface | null>(null);
  const [
    showSampleAttributeModal,
    setShowSampleAttributeModal,
  ] = useState<SampleUserAttributeValues | null>(null);

  useEffect(() => {
    apiCall<{
      results: FeatureTestResult[];
    }>(`/feature/${feature.id}/eval`, {
      method: "POST",
      body: JSON.stringify({ attributes: user.attributes }),
    })
      .then((data) => {
        setResults(data.results);
      })
      .catch((e) => console.error(e));
  }, [user, apiCall, feature.id]);

  if (!results) {
    return <div>Loading...</div>;
  }

  const colSize =
    Math.floor(12 / results.length) < 3 ? 3 : Math.floor(12 / results.length);

  return (
    <div
      className={`${styles.wrap} bg-light border border-secondary rounded mb-2`}
    >
      {state === "compact" ? (
        <div className={`${styles.compactRow}`}>
          <div className="row">
            <div className="col-3">
              <h4 className="d-inline-block mb-0">{user.name}</h4>{" "}
              {user.description && (
                <>
                  - <span className="text-muted">{user.description}</span>
                </>
              )}
            </div>
            {results.map((tr, i) => {
              return (
                <div
                  className={`col ${tr?.enabled ? "" : styles.disabledResult}`}
                  key={i}
                >
                  <strong className=" mr-2">{tr.env}:</strong>
                  {!tr.enabled ? (
                    <span>Disabled</span>
                  ) : (
                    <ValueDisplay
                      value={tr?.result?.value}
                      type={feature.valueType}
                    />
                  )}
                </div>
              );
            })}
            <div className="col-auto">
              <a
                className="small"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setState("expanded");
                }}
              >
                see more details
              </a>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-3">
          <div className="">
            <div
              className="float-right position-relative"
              style={{ top: "-5px" }}
            >
              <MoreMenu>
                <button
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditSavedUser(user);
                  }}
                >
                  Edit
                </button>
                <DeleteButton
                  className="dropdown-item"
                  displayName="Saved User"
                  text="Delete"
                  useIcon={false}
                  onClick={async () => {
                    console.log("delete: ", user.id);
                    await apiCall(`/sample-users/${user.id}`, {
                      method: "DELETE",
                    });
                    if (updated) {
                      updated(user);
                    }
                  }}
                />
              </MoreMenu>
            </div>
            <h4 className="d-inline-block">{user.name}</h4>{" "}
            {user.description && (
              <>
                - <span className="text-muted">{user.description}</span>
              </>
            )}
            <a
              href="#"
              className="small ml-2"
              onClick={(e) => {
                e.preventDefault();
                setShowSampleAttributeModal(user.attributes);
              }}
            >
              (see attributes)
            </a>
          </div>
          <div className="row" style={{ clear: "both" }}>
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
                <div className={`col-${colSize}`} key={i}>
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
                      {!tr?.enabled ? (
                        <div className="text-center">
                          Feature disabled for this environment
                        </div>
                      ) : (
                        <>
                          <div className="row align-items-top">
                            <div className="col-auto">
                              <span>Value served:</span>
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
                          <div className="pt-2">
                            <span>Matched rule: </span>
                            <strong>{matchedRuleName}</strong>
                          </div>
                        </>
                      )}
                    </div>
                    {tr?.result && (
                      <>
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
        </div>
      )}
      {showSampleAttributeModal && (
        <Modal
          open={true}
          close={() => setShowSampleAttributeModal(null)}
          header="Attributes used"
        >
          <div>
            <Code
              language="json"
              code={JSON.stringify(showSampleAttributeModal, null, 2)}
            />
          </div>
        </Modal>
      )}
      {editSavedUser && (
        <SampleUserAttributesModal
          close={() => {
            setEditSavedUser(null);
          }}
          initialValues={editSavedUser}
          header="Edit Sample User"
        />
      )}
    </div>
  );
};

export default TestFeatureResults;
