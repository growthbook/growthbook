import React, { FC, Fragment, useState } from "react";
import { ArchetypeInterface } from "back-end/types/archetype";
import { FeatureInterface, FeatureTestResult } from "back-end/types/feature";
import { filterEnvironmentsByFeature } from "shared/util";
import Link from "next/link";
import styles from "@/components/Archetype/ArchetypeResults.module.scss";
import { ArchetypeValueDisplay } from "@/components/Features/ValueDisplay";
import Code from "@/components/SyntaxHighlighting/Code";
import Tooltip from "@/components/Tooltip/Tooltip";
import ArchetypeAttributesModal from "@/components/Archetype/ArchetypeAttributesModal";
import { useEnvironments } from "@/services/features";
import { parseFeatureResult } from "@/hooks/useArchetype";

const ArchetypeResults: FC<{
  feature: FeatureInterface;
  archetype: ArchetypeInterface[];
  featureResults: Record<string, FeatureTestResult[]>;
  onChange: () => void;
}> = ({ feature, archetype, featureResults, onChange }) => {
  const enableAdvDebug = false;
  const [showExpandedResults, setShowExpandedResults] =
    useState<boolean>(false);
  const [showExpandedResultsId, setShowExpandedResultsId] = useState<
    string | null
  >(null);
  const [showExpandedResultsEnv, setShowExpandedResultsEnv] = useState<
    string | null
  >(null);
  const [editArchetype, setEditArchetype] =
    useState<Partial<ArchetypeInterface> | null>(null);

  const allEnvironments = useEnvironments();
  const environments = filterEnvironmentsByFeature(allEnvironments, feature);

  if (archetype.length === 0) {
    return null;
  }

  const detailsMap = new Map();
  Object.keys(featureResults).map((id) => {
    const res = featureResults[id];
    res.map((tr: FeatureTestResult) => {
      const { matchedRule, matchedRuleName, brief, debugLog } =
        parseFeatureResult(tr);
      detailsMap.set(id + tr.env, {
        matchedRuleName,
        matchedRule,
        brief,
        debugLog,
        results: tr,
        log: tr.log,
        archetype: archetype.find((u) => u.id === id),
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
    archetype: ArchetypeInterface;
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
                  Debug info for archetype{" "}
                  <strong>{details.archetype.name}</strong>{" "}
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
                <h5>Attributes</h5>
                <Code
                  language="json"
                  code={JSON.stringify(
                    JSON.parse(details.archetype.attributes),
                    null,
                    2,
                  )}
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
                      2,
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
                    2,
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
    <div className={`mb-3`} style={{ overflowX: "auto" }}>
      <table className="table gbtable appbox">
        <thead>
          <tr>
            <th>
              <Link href="/archetypes">Archetype</Link>
            </th>
            {environments.map((env) => (
              <th key={env.id} title={env.description}>
                {env.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {archetype.map((archetype: ArchetypeInterface) => {
            if (!archetype.attributes) {
              archetype.attributes = "{}";
            }
            let attrDisplay = "";
            try {
              const attrsObj = JSON.parse(archetype.attributes);
              attrDisplay = JSON.stringify(attrsObj, null, 2);
            } catch (e) {
              console.error("Error parsing archetype attributes", e);
            }
            return (
              <Fragment key={archetype.id}>
                <tr
                  key={archetype.id}
                  className={`${
                    showExpandedResultsId === archetype.id
                      ? styles.rowExpanded
                      : ""
                  }`}
                >
                  <td>
                    <Tooltip
                      body={
                        <>
                          <Code code={attrDisplay} language="json" />
                        </>
                      }
                      flipTheme={false}
                    >
                      {archetype.name}
                      {archetype.description && (
                        <>
                          <br />
                          <span className="small text-muted">
                            {archetype.description}
                          </span>
                        </>
                      )}
                    </Tooltip>
                  </td>
                  {featureResults[archetype.id] &&
                    featureResults[archetype.id].map(
                      (result: FeatureTestResult) => (
                        <td
                          key={result.env}
                          className={`${styles.valueCell} cursor-pointer ${
                            showExpandedResultsId === archetype.id &&
                            showExpandedResultsEnv === result.env
                              ? styles.cellExpanded
                              : ""
                          }`}
                          onClick={() => {
                            if (enableAdvDebug) {
                              if (
                                showExpandedResults &&
                                showExpandedResultsId === archetype.id &&
                                showExpandedResultsEnv === result.env
                              ) {
                                // the current details are already open, so close them:
                                setShowExpandedResults(false);
                                setShowExpandedResultsId(null);
                                setShowExpandedResultsEnv(null);
                              } else {
                                setShowExpandedResults(true);
                                setShowExpandedResultsId(archetype.id);
                                setShowExpandedResultsEnv(result.env);
                              }
                            }
                          }}
                        >
                          {result.enabled ? (
                            <>{ArchetypeValueDisplay({ result, feature })}</>
                          ) : (
                            <span className="text-muted">disabled</span>
                          )}
                        </td>
                      ),
                    )}
                </tr>
                {showExpandedResults &&
                  showExpandedResultsId === archetype.id && (
                    <>
                      {expandedResults(
                        detailsMap.get(
                          showExpandedResultsId + showExpandedResultsEnv,
                        ),
                      )}
                    </>
                  )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {editArchetype && (
        <ArchetypeAttributesModal
          close={() => {
            setEditArchetype(null);
            onChange();
          }}
          initialValues={editArchetype}
          header={
            Object.keys(editArchetype).length === 0
              ? "Create Archetype"
              : "Edit Archetype"
          }
        />
      )}
    </div>
  );
};

export default ArchetypeResults;
