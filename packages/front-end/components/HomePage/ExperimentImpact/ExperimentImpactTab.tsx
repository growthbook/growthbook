import Link from "next/link";
import React, { ReactElement } from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import { date } from "shared/dates";
import Tooltip from "@/components/Tooltip/Tooltip";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import ResultsIndicator from "@/components/Experiment/ResultsIndicator";
import {
  ExperimentImpactData,
  ExperimentImpactType,
  NoExperimentsForImpactBanner,
  formatImpact,
} from ".";

interface Props {
  experimentImpactData: ExperimentImpactData;
  experimentImpactType: ExperimentImpactType;
  formatter: (
    value: number,
    options?: Intl.NumberFormatOptions | undefined,
  ) => string;
  formatterOptions: Intl.NumberFormatOptions;
}

export default function ExperimentImpactTab({
  experimentImpactData,
  experimentImpactType,
  formatter,
  formatterOptions,
}: Props) {
  const expRows: ReactElement[] = [];
  let anyNullImpact = false;
  experimentImpactData.experiments.forEach((e, ei) => {
    const variations: JSX.Element[] = [];
    const impactsScaled: JSX.Element[] = [];
    const impactsTotal: JSX.Element[] = [];
    if (!e.error) {
      e.experiment.variations.forEach((v, i) => {
        if (i === 0) return;
        if (experimentImpactType !== "other" && i !== e.keyVariationId) return;
        const impact = e.variationImpact?.[i - 1];
        if (!impact) {
          anyNullImpact = true;
        }
        variations.push(
          <div
            key={`var-experiment${ei}-variation${i}`}
            className={`variation variation${i} with-variation-label d-flex my-1`}
          >
            <span className="label" style={{ width: 20, height: 20 }}>
              {i}
            </span>
            <span
              className="d-inline-block text-ellipsis hover"
              style={{
                maxWidth: 200,
              }}
            >
              {v.name}
            </span>
          </div>,
        );
        impactsScaled.push(
          <div
            key={`imp-experiment${ei}-variation${i}`}
            className={clsx("my-1", { won: experimentImpactType === "winner" })}
          >
            {impact ? (
              formatImpact(
                impact?.scaledImpact ?? 0,
                formatter,
                formatterOptions,
              )
            ) : (
              <span className="text-muted">N/A</span>
            )}
            {!!impact && (
              <span className="small text-muted">
                {" "}
                &times;{" "}
                {Intl.NumberFormat(undefined, {
                  maximumFractionDigits: 3,
                }).format(
                  (impact.scaledImpactAdjusted ?? 0) /
                    (impact.scaledImpact ?? 0),
                )}{" "}
                &times; 365{" "}
              </span>
            )}
          </div>,
        );
        impactsTotal.push(
          <div
            key={`imptotal-experiment${ei}-variation${i}`}
            className={clsx("my-1", { won: experimentImpactType === "winner" })}
          >
            {impact ? (
              formatImpact(
                (impact?.scaledImpactAdjusted ?? 0) * 365,
                formatter,
                formatterOptions,
              )
            ) : (
              <span className="text-muted">N/A</span>
            )}
            {!!impact && impact.se && (
              <span className="plusminus ml-1">
                ± {formatter(impact.se * 1.96 * 365, formatterOptions)}
              </span>
            )}
          </div>,
        );
      });
    }
    expRows.push(
      <tr key={e.experiment.id} className="hover-highlight">
        <td>
          <div className="my-1">
            <Link
              className="font-weight-bold"
              href={`/experiment/${e.experiment.id}`}
            >
              {e.experiment.name}
            </Link>
          </div>
        </td>
        <td>
          <div className="my-1">
            {e.experiment.status === "stopped" ? (
              date(
                e.experiment.phases?.[e.experiment.phases.length - 1]
                  ?.dateEnded ?? "",
              )
            ) : (
              <span className="text-muted">N/A</span>
            )}
          </div>
        </td>
        <td>
          <div className="d-flex">
            {e.experiment.results && e.experiment.status === "stopped" ? (
              <div
                className="experiment-status-widget d-inline-block position-relative"
                style={{ height: 25, lineHeight: "25px", top: 2 }}
              >
                <ResultsIndicator results={e.experiment.results} />
              </div>
            ) : (
              <div className="my-1">
                <ExperimentStatusIndicator experimentData={e.experiment} />
              </div>
            )}
          </div>
        </td>
        {e.error ? (
          <td colSpan={3}>
            <div className="alert alert-danger px-2 py-1 mb-1 ml-1">
              <FaExclamationTriangle className="mr-1" />
              {e.error}
            </div>
          </td>
        ) : (
          <>
            <td>{variations}</td>
            <td className="impact-results">{impactsScaled}</td>
            <td className="impact-results">{impactsTotal}</td>
          </>
        )}
      </tr>,
    );
  });
  return (
    <div className="px-3 pt-3">
      {experimentImpactData.experiments.length === 0 ? (
        <NoExperimentsForImpactBanner />
      ) : (
        <>
          {experimentImpactType !== "other" ? (
            <div
              className={`mt-2 alert alert-${
                experimentImpactType === "winner" ? "success" : "info"
              }`}
            >
              <span style={{ fontSize: "1.2em" }}>
                {formatImpact(
                  experimentImpactData.totalAdjustedImpact * 365,
                  formatter,
                  formatterOptions,
                )}
                {` per year is the summed impact ${
                  experimentImpactType === "winner"
                    ? "of the winning variations."
                    : "of not shipping the worst variation."
                } `}
              </span>
            </div>
          ) : null}

          <div className="mt-4" style={{ maxHeight: 500, overflowY: "auto" }}>
            <table className="table border">
              <thead className="bg-light">
                <tr>
                  <th>
                    Experiment
                    <Tooltip
                      className="ml-1"
                      body={"Does not include Bandits"}
                    />
                  </th>
                  <th>Date Ended</th>
                  <th>Status</th>
                  <th>
                    {experimentImpactType === "winner"
                      ? "Winning Variation"
                      : experimentImpactType === "loser"
                        ? "Worst Variation"
                        : "Variation"}
                  </th>
                  <th>
                    Scaled Impact{" "}
                    <span className="small text-muted">
                      &times; adj &times; 365
                    </span>
                    <Tooltip
                      className="ml-1"
                      body={
                        <>
                          <div className={anyNullImpact ? "mb-2" : ""}>
                            {`This Daily Scaled Impact, available in your Experiment
                              Results under the "Scaled Impact" Difference Type, is 
                              adjusted if de-biasing is set to true and multiplied by
                              365 to yield the Annual Adjusted Scaled Impact.`}
                          </div>
                          {anyNullImpact ? (
                            <div>
                              {`N/A values occur if we were unable to compute scaled
                                impact for that experiment, perhaps due to stale
                                experiment data.`}
                            </div>
                          ) : null}
                        </>
                      }
                    />
                  </th>
                  <th>Annual Adj. Scaled Impact</th>
                </tr>
              </thead>
              <tbody>{expRows}</tbody>
              <tbody className="bg-light font-weight-bold">
                <tr>
                  <td>Total Impact</td>
                  <td colSpan={4} />
                  <td>
                    {experimentImpactType !== "other" ? (
                      <>
                        {formatImpact(
                          experimentImpactData.totalAdjustedImpact * 365,
                          formatter,
                          formatterOptions,
                        )}
                        {experimentImpactData.totalAdjustedImpactVariance ? (
                          <span className="plusminus ml-1">
                            ±{" "}
                            {formatter(
                              Math.sqrt(
                                experimentImpactData.totalAdjustedImpactVariance,
                              ) *
                                1.96 *
                                365,
                              formatterOptions,
                            )}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span>N/A</span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
