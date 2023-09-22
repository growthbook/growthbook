import React, { FC, Fragment, useState } from "react";
import { SampleUsersInterface } from "back-end/types/sample-users";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { useAuth } from "@/services/auth";
import styles from "@/components/Attributes/SampleUsersResults.module.scss";
import ValueDisplay from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import SampleUserAttributesModal from "@/components/Attributes/SampleUserAttributesModal";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";

const SampleUsersResults: FC<{
  feature: FeatureInterface;
}> = ({ feature }) => {
  const { apiCall } = useAuth();
  //const [state, setState] = useState<"compact" | "expanded">(initialState);
  const [showExpandedResults, setShowExpandedResults] = useState<boolean>(
    false
  );
  const [showExpandedResultsId, setShowExpandedResultsId] = useState<
    string | null
  >(null);
  const [showExpandedResultsEnv, setShowExpandedResultsEnv] = useState<
    string | null
  >(null);
  const [
    editSavedUser,
    setEditSavedUser,
  ] = useState<SampleUsersInterface | null>(null);

  const environments = useEnvironments();

  const { data, error, mutate } = useApi<{
    status: number;
    sampleUsers: SampleUsersInterface[];
    featureResults: FeatureTestResult[];
  }>(`/sample-users/eval/${feature.id}`);

  if (!data) {
    return <div>Loading...</div>;
  }
  if (error) {
    console.error(error);
    return null;
  }
  if (data.status && !data.sampleUsers) {
    return null;
  }

  if (data.sampleUsers.length === 0) {
    return null;
  }

  const detailsMap = new Map();
  Object.keys(data.featureResults).map((id) => {
    const res = data.featureResults[id];
    res.map((tr: FeatureTestResult) => {
      let matchedRule;
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
      detailsMap.set(id + tr.env, {
        matchedRuleName,
        matchedRule,
        brief,
        results: tr,
        log: tr.log,
        user: data.sampleUsers.find((u) => u.id === id),
      });
    });
  });

  const numEnvs = environments.length;

  const expandedResults = (details?: {
    matchedRuleName: string;
    matchedRule: object;
    brief: string;
    log: [string, never][];
    results: FeatureTestResult;
    user: SampleUsersInterface;
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
                  <Code
                    language="json"
                    code={JSON.stringify(details.log, null, 2)}
                  />
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
          {data.sampleUsers.map((user: SampleUsersInterface) => (
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
                {data.featureResults[user.id].map(
                  (result: FeatureTestResult) => (
                    <td
                      key={result.env}
                      className={`${styles.valueCell} cursor-pointer ${
                        showExpandedResultsId === user.id &&
                        showExpandedResultsEnv === result.env
                          ? styles.cellExpanded
                          : ""
                      }`}
                      onClick={() => {
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
                      }}
                    >
                      {result.enabled ? (
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
                      ) : (
                        <span className="text-muted">disabled</span>
                      )}
                    </td>
                  )
                )}
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
                        await apiCall(`/sample-users/${user.id}`, {
                          method: "DELETE",
                        });
                        mutate();
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
        <SampleUserAttributesModal
          close={() => {
            setEditSavedUser(null);
            mutate();
          }}
          initialValues={editSavedUser}
          header="Edit Sample User"
        />
      )}
    </div>
  );
};

export default SampleUsersResults;
