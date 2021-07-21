import React, { FC } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import SRMWarning from "./SRMWarning";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { useDefinitions } from "../../services/DefinitionsContext";
import { useState } from "react";
import CompactTable from "./CompactTable";
import GuardrailResults from "./GuardrailResult";

function hasEnoughData(value1: number, value2: number): boolean {
  return Math.max(value1, value2) >= 150 && Math.min(value1, value2) >= 25;
}

const CompactResults: FC<{
  snapshot: ExperimentSnapshotInterface;
  experiment: ExperimentInterfaceStringDates;
  barFillType?: "gradient" | "significant";
  barType?: "pill" | "violin";
}> = ({
  snapshot,
  experiment,
  barFillType = "gradient",
  barType = "violin",
}) => {
  const { getMetricById } = useDefinitions();

  const results = snapshot.results[0];
  const variations = results?.variations || [];

  const [riskVariation, setRiskVariation] = useState(() => {
    // Calculate the total risk for each variation across all metrics
    const sums: number[] = Array(variations.length).fill(0);
    experiment.metrics.forEach((m) => {
      const metric = getMetricById(m);
      if (!metric) return;

      let controlMax = 0;
      const controlCR = variations[0].metrics[m]?.cr;
      if (!controlCR) return;
      variations.forEach((v, i) => {
        if (!i) return;
        if (
          !hasEnoughData(v.metrics[m]?.value, variations[0].metrics[m]?.value)
        ) {
          return;
        }
        const risk = v.metrics[m]?.risk;
        const cr = v.metrics[m]?.cr;
        if (!risk) return;

        const controlRisk = (metric.inverse ? risk[1] : risk[0]) / controlCR;
        controlMax = Math.max(controlMax, controlRisk);

        sums[i] += (metric.inverse ? risk[0] : risk[1]) / cr;
      });
      sums[0] += controlMax;
    });

    // Default to the variation with the lowest total risk
    return sums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0][1];
  });

  return (
    <div>
      <div className="mb-4 experiment-compact-holder">
        <SRMWarning srm={results.srm} />

        <CompactTable
          snapshot={snapshot}
          experiment={experiment}
          metrics={experiment.metrics}
          barFillType={barFillType}
          barType={barType}
          riskVariation={riskVariation}
          setRiskVariation={setRiskVariation}
        />
      </div>

      {experiment.guardrails?.length > 0 && (
        <div className="mb-3">
          <hr />
          <h2 className="mt-4">Guardrails</h2>
          <div className="row mt-3">
            {experiment.guardrails.map((g) => {
              const metric = getMetricById(g);
              if (!metric) return "";

              return (
                <div className="col-12 col-xl-4 col-lg-6 mb-3" key={g}>
                  <GuardrailResults
                    experiment={experiment}
                    variations={results.variations}
                    metric={metric}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
export default CompactResults;
