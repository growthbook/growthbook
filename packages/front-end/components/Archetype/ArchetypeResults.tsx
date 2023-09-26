import React, { FC, Fragment, useState } from "react";
import { ArchetypeInterface } from "back-end/types/archetype";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import { useEnvironments } from "@/services/features";

const ArchetypeResults: FC<{
  feature: FeatureInterface;
  Archetype: ArchetypeInterface[];
  featureResults: Record<string, FeatureTestResult[]>;
  onChange: () => void;
}> = ({ feature, Archetype, featureResults, onChange }) => {
  const { apiCall } = useAuth();
  const enableAdvDebug = false;
  const [showExpandedResults, setShowExpandedResults] = useState<boolean>(
    false
  );
  const [showExpandedResultsId, setShowExpandedResultsId] = useState<
    string | null
  >(null);
  const [showExpandedResultsEnv, setShowExpandedResultsEnv] = useState<
    string | null
  >(null);
  const [editSavedUser, setEditSavedUser] = useState<ArchetypeInterface | null>(
    null
  );

  const environments = useEnvironments();

  if (Archetype.length === 0) {
    return null;
  }

  const detailsMap = new Map();
  Object.keys(featureResults).map((id) => {
    const res = featureResults[id];
    res.map((tr: FeatureTestResult) => {
      let matchedRule;
      const debugLog: string[] = [];
      if (tr?.result?.ruleId && tr?.featureDefinition?.rules) {
        matchedRule = tr.featureDefinition.rules.find(
          (r) => r.id === tr?.result?.ruleId
        );
      }
      let matchedRuleName = "";
      let brief = "";
      if (tr?.result?.source === "experiment") {
        const expName =
          tr.result?.experimentResult?.name ||
          tr?.result?.experiment?.key ||
          null;
        matchedRuleName = "Experiment" + (expName ? " (" + expName + ")" : "");
        brief = "In experiment";
      } else if (tr?.result?.source === "force") {
        matchedRuleName = "Forced";
        brief = "Force";
        if (matchedRule && matchedRule?.coverage) {
          matchedRuleName = "Rollout (" + matchedRule?.coverage * 100 + "%)";
          brief = "Rollout";
        }
      } else if (tr?.result?.source === "defaultValue") {
        matchedRuleName = "None - Returned Default Value";
        brief = "Default";
      }
      if (tr?.log) {
        tr.log.forEach((log) => {
          const reason = log[0];
          if (reason === "Skip rule because of condition") {
            debugLog.push(
              `Skipped because user did not match the rule conditions`
            );
          } else if (
            reason === "Skip rule because user not included in rollout"
          ) {
            debugLog.push(
              `Skipped rule because the user is not included in rollout`
            );
          } else if (reason === "In experiment") {
            debugLog.push(`Included user in experiment rule`);
          } else if (reason === "Use default value") {
            debugLog.push(`No rules matched, using default value`);
          } else {
            debugLog.push(`${log[0]}`);
          }
        });
      }
      detailsMap.set(id + tr.env, {
        matchedRuleName,
        matchedRule,
        brief,
        debugLog,
        results: tr,
        log: tr.log,
        user: Archetype.find((u) => u.id === id),
      });
    });
  });

  const numEnvs = environments.length;

  const expandedResults = (details?: {
    matchedRuleName: string;
    matchedRule: object;
    brief: string;
    log: [string, never][];
    debugLog: string[];
    results: FeatureTestResult;
    user: ArchetypeInterface;
  }) => {
    if (!details) {
      return null;
    }
    return (
      <tr className={styles.expandedRow}>
        <td colSpan={numEnvs + 2}>
          <div className="row">
            <div className="col-12">
              <div className={styles.closeButton}>
                <button
                  className="btn btn-sm "
                  onClick={() => {
                    setShowExpandedResults(false);
                    setShowExpandedResultsId(null);
                    setShowExpandedResultsEnv(null);
                  }}
                >
                  <span aria-hidden="true" style={{ fontSize: "1.4rem" }}>
                    &times;
                  </span>
                </button>
              </div>
              <div className="text-center">
                <span className="uppercase-title text-muted">
                  Debug info for sample user{" "}
                  <strong>{details.user.name}</strong> on{" "}
                  <strong>{details.results.env}</strong>
                </span>
              </div>
              {!details.results.enabled ? (
                <div className="text-center p-2 text-muted">
                  Feature disabled for this environment
                </div>
              ) : (
                <div className="">
                  <span className="text-muted">Matched rule:</span>{" "}
                  <strong>{details.matchedRuleName}</strong>
                </div>
              )}
            </div>
          </div>
          {details.results?.result && (
            <div className="row mt-3">
              {details.log?.length > 0 && (
                <div className="col">
                  <h5>Log</h5>
                  <div className="bg-white border border-light rounded p-3">
                    {details.debugLog.map((log, i) => (
                      <div className="row mb-3" key={i}>
                        <div className="col-auto">
                          <div
                            key={i}
                            className={`text-light border rounded-circle ${"bg-purple"}`}
                            style={{
                              width: 28,
                              height: 28,
                              lineHeight: "26px",
                              textAlign: "center",
                              fontWeight: "bold",
                            }}
                          >
                            {i + 1}
                          </div>
                        </div>
                        <div className="col">{log}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="col">
                <h5>User attributes</h5>
                <Code
                  language="json"
                  code={JSON.stringify(details.user.attributes, null, 2)}
                />
              </div>
              {details.results?.result?.experimentResult && (
                <div className="col">
                  <h5>Experiment result</h5>
                  <Code
                    language="json"
                    code={JSON.stringify(
                      details.results.result.experimentResult,
                      null,
                      2
                    )}
                  />
                </div>
              )}
              {details.results?.result?.ruleId && (
                <div className="col">
                  <h5>Matched Rule</h5>
                  <Code
                    language="json"
                    code={JSON.stringify(details.matchedRule, null, 2)}
                  />
                </div>
              )}
              <div className="col">
                <h5>Feature value</h5>
                <Code
                  language="json"
                  code={JSON.stringify(
                    details.results?.featureDefinition,
                    null,
                    2
                  )}
                />
              </div>
            </div>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className={`my-3`}>
      <table className="table gbtable appbox ">
        <thead>
          <tr>
            <th>Saved sample user</th>
            {environments.map((env) => (
              <th key={env.id} title={env.description}>
                {env.id}
              </th>
            ))}
            <th style={{ width: "40px" }}></th>
          </tr>
        </thead>
        <tbody>
          {Archetype.map((user: ArchetypeInterface) => (
            <Fragment key={user.id}>
              <tr
                key={user.id}
                className={`${
                  showExpandedResultsId === user.id ? styles.rowExpanded : ""
                }`}
              >
                <td>
                  <Tooltip
                    body={
                      <>
                        <Code
                          code={JSON.stringify(user.attributes, null, 2)}
                          language="json"
                        />
                      </>
                    }
                  >
                    {user.name}
                    {user.description && (
                      <>
                        <br />
                        <span className="small text-muted">
                          {user.description}
                        </span>
                      </>
                    )}
                  </Tooltip>
                </td>
                {featureResults[user.id].map((result: FeatureTestResult) => (
                  <td
                    key={result.env}
                    className={`${styles.valueCell} cursor-pointer ${
                      showExpandedResultsId === user.id &&
                      showExpandedResultsEnv === result.env
                        ? styles.cellExpanded
                        : ""
                    }`}
                    onClick={() => {
                      if (enableAdvDebug) {
                        if (
                          showExpandedResults &&
                          showExpandedResultsId === user.id &&
                          showExpandedResultsEnv === result.env
                        ) {
                          // the current details are already open, so close them:
                          setShowExpandedResults(false);
                          setShowExpandedResultsId(null);
                          setShowExpandedResultsEnv(null);
                        } else {
                          setShowExpandedResults(true);
                          setShowExpandedResultsId(user.id);
                          setShowExpandedResultsEnv(result.env);
                        }
                      }
                    }}
                  >
                    {result.enabled ? (
                      <>
                        <Tooltip
                          className="d-inline-block"
                          body={
                            <>
                              {!detailsMap.get(user.id + result.env).results
                                .enabled ? (
                                <div className="text-center p-2 text-muted">
                                  Feature disabled for this environment
                                </div>
                              ) : (
                                <div className="">
                                  <span className="text-muted">
                                    Matched rule:
                                  </span>{" "}
                                  <strong>
                                    {
                                      detailsMap.get(user.id + result.env)
                                        .matchedRuleName
                                    }
                                  </strong>
                                </div>
                              )}
                              <h5 className="mt-3">Log</h5>
                              <div className="bg-white border border-light rounded p-3">
                                {detailsMap
                                  .get(user.id + result.env)
                                  .debugLog.map((log, i) => (
                                    <div className="row my-2" key={i}>
                                      <div className="col-2">
                                        {detailsMap.get(user.id + result.env)
                                          ?.results?.result?.source ===
                                          "defaultValue" &&
                                        i ===
                                          detailsMap.get(user.id + result.env)
                                            .debugLog.length -
                                            1 ? (
                                          <></>
                                        ) : (
                                          <div
                                            key={i}
                                            className={`text-light border rounded-circle ${"bg-purple"}`}
                                            style={{
                                              width: 28,
                                              height: 28,
                                              lineHeight: "26px",
                                              textAlign: "center",
                                              fontWeight: "bold",
                                            }}
                                          >
                                            {i + 1}
                                          </div>
                                        )}
                                      </div>
                                      <div className="col">{log}</div>
                                    </div>
                                  ))}
                              </div>
                            </>
                          }
                        >
                          <>
                            <div>
                              <ValueDisplay
                                value={result.result?.value ?? null}
                                type={feature.valueType}
                                full={true}
                              />
                            </div>
                            <span className="text-muted small">
                              {detailsMap.get(user.id + result.env)?.brief}
                            </span>
                          </>
                        </Tooltip>
                      </>
                    ) : (
                      <span className="text-muted">disabled</span>
                    )}
                  </td>
                ))}
                <td className={styles.showOnHover}>
                  <MoreMenu>
                    <button
                      className="dropdown-item"
                      onClick={() => {
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
                        await apiCall(`/archetype/${user.id}`, {
                          method: "DELETE",
                        });
                        onChange();
                      }}
                    />
                  </MoreMenu>
                </td>
              </tr>
              {showExpandedResults && showExpandedResultsId === user.id && (
                <>
                  {expandedResults(
                    detailsMap.get(
                      showExpandedResultsId + showExpandedResultsEnv
                    )
                  )}
                </>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {editSavedUser && (
        <ArchetypeAttributesModal
          close={() => {
            setEditSavedUser(null);
            onChange();
          }}
          initialValues={editSavedUser}
          header="Edit Sample User"
        />
      )}
    </div>
  );
};

export default ArchetypeResults;
