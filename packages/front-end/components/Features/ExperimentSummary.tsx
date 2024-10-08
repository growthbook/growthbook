import { ExperimentRule, FeatureInterface } from "back-end/types/feature";
import Link from "next/link";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  getExperimentDefinitionFromFeature,
  getVariationColor,
} from "@/services/features";
import ValidateValue from "@/components/Features/ValidateValue";
import NewExperimentForm from "@/components/Experiment/NewExperimentForm";
import Modal from "@/components/Modal";
import useOrgSettings from "@/hooks/useOrgSettings";
import ValueDisplay from "./ValueDisplay";
import ExperimentSplitVisual from "./ExperimentSplitVisual";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function ExperimentSummary({
  rule,
  experiment,
  feature,
}: {
  feature: FeatureInterface;
  experiment?: ExperimentInterfaceStringDates;
  rule: ExperimentRule;
}) {
  const { namespace, coverage, values, hashAttribute, trackingKey } = rule;
  const type = feature.valueType;
  const { namespaces: allNamespaces } = useOrgSettings();

  const { datasources, metrics } = useDefinitions();
  const [newExpModal, setNewExpModal] = useState(false);
  const [experimentInstructions, setExperimentInstructions] = useState(false);

  const expDefinition = getExperimentDefinitionFromFeature(feature, rule);

  const hasNamespace = namespace && namespace.enabled;
  const namespaceRange = hasNamespace
    ? namespace.range[1] - namespace.range[0]
    : 1;
  const effectiveCoverage = namespaceRange * (coverage ?? 1);

  return (
    <div>
      {newExpModal && (
        <NewExperimentForm
          onClose={() => setNewExpModal(false)}
          source="feature-rule"
          isImport={true}
          fromFeature={true}
          msg="We couldn't find an analysis yet for that feature. Create a new one now."
          initialValue={expDefinition || undefined}
        />
      )}
      {experimentInstructions && (
        <Modal
          header={"Experiments need to be set up first"}
          open={true}
          size="lg"
          close={() => {
            setExperimentInstructions(false);
          }}
          cta={"Set up experiments"}
        >
          <div className="row">
            <div className="col-8 pl-2 mt-2">
              In order to view the results, you first have to set up experiments
              by connecting to your data source, and adding a metric.
              <div className="mt-5">
                <Link
                  href={`/experiments/?featureExperiment=${encodeURIComponent(
                    JSON.stringify(expDefinition)
                  )}`}
                  className="btn btn-primary"
                >
                  Set up experiments
                </Link>
              </div>
            </div>
            <div className="col-4">
              <img
                className=""
                src="/images/add-graph.svg"
                alt=""
                style={{ width: "100%", maxWidth: "200px" }}
              />
            </div>
          </div>
        </Modal>
      )}
      <div className="mb-3 row">
        <div className="col-auto">
          <strong>SPLIT</strong>
        </div>
        <div className="col-auto">
          {" "}
          users by{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {hashAttribute || ""}
          </span>
          {hasNamespace && (
            <>
              {" "}
              <span>in the namespace </span>
              <span className="mr-1 border px-2 py-1 bg-light rounded">
                {allNamespaces?.find((n) => n.name === namespace.name)?.label ||
                  namespace.name}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="mb-3 row">
        <div className="col-auto">
          <strong>INCLUDE</strong>
        </div>
        <div className="col-auto">
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {percentFormatter.format(effectiveCoverage)}
          </span>{" "}
          of users in the experiment
          {hasNamespace && (
            <>
              <span> (</span>
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(namespaceRange)}
              </span>{" "}
              of the namespace and{" "}
              <span className="border px-2 py-1 bg-light rounded">
                {percentFormatter.format(coverage ?? 1)}
              </span>
              <span> exposure)</span>
            </>
          )}
        </div>
      </div>
      <strong>SERVE</strong>

      <table className="table mt-1 mb-3 bg-light gbtable">
        <tbody>
          {values.map((r, j) => (
            <tr key={j}>
              <td
                className="text-muted position-relative"
                style={{ fontSize: "0.9em", width: 25 }}
              >
                <div
                  style={{
                    width: "6px",
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: 0,
                    backgroundColor: getVariationColor(j),
                  }}
                />
                {j}.
              </td>
              <td>
                <ValueDisplay
                  value={r.value}
                  type={type}
                  defaultVal={feature.defaultValue}
                />
                <ValidateValue value={r.value} feature={feature} />
              </td>
              <td>{r?.name}</td>
              <td>
                <div className="d-flex">
                  <div
                    style={{
                      width: "4em",
                      maxWidth: "4em",
                      margin: "0 0 0 auto",
                    }}
                  >
                    {percentFormatter.format(r.weight)}
                  </div>
                </div>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={4}>
              <ExperimentSplitVisual
                values={values}
                coverage={effectiveCoverage}
                label="Traffic split"
                unallocated="Not included (skips this rule)"
                type={type}
                showValues={false}
                stackLeft={true}
                showPercentages={true}
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div className="row align-items-center">
        <div className="col-auto">
          <strong>TRACK</strong>
        </div>
        <div className="col">
          {" "}
          the result using the key{" "}
          <span className="mr-1 border px-2 py-1 bg-light rounded">
            {trackingKey || feature.id}
          </span>{" "}
        </div>
        <div className="col-auto">
          {experiment ? (
            <Link
              href={`/experiment/${experiment.id}#results`}
              className="btn btn-outline-primary"
            >
              View results
            </Link>
          ) : datasources.length > 0 && metrics.length > 0 ? (
            <a
              className="btn btn-outline-primary"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setNewExpModal(true);
              }}
              title="Create an experiment report from this rule"
            >
              View results
            </a>
          ) : (
            <a
              className="btn btn-outline-primary"
              title="Setup experiments to view results"
              onClick={(e) => {
                e.preventDefault();
                setExperimentInstructions(true);
              }}
            >
              View results
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
