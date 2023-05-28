import clsx from "clsx";
import { ago } from "@/../shared/dates";
import { cloneDeep } from "lodash";
import { useState } from "react";
import Tooltip from "../Tooltip/Tooltip";
import Toggle from "../Forms/Toggle";
import Button from "../Button";
import SQLInputField from "../SQLInputField";

type Props = {
  metric: any;
  setMetricsToCreate: any;
  metricsToCreate: any;
  dataSourceId: string;
  form: any;
  i: number;
};

export default function AutoMetricCard({
  metric,
  setMetricsToCreate,
  metricsToCreate,
  dataSourceId,
  form,
  i,
}: Props) {
  const [showBinomialSqlPreview, setShowBinomialSqlPreview] = useState(false);
  const [showCountSqlPreview, setShowCountSqlPreview] = useState(false);

  return (
    <div className="p-2 mb-1">
      <div className="d-flex justify-content-between">
        <div className="d-flex align-items-center pb-3">
          <h4 className="mb-0">{metric.displayName}</h4>
          <Tooltip
            className="pl-2 font-italic"
            body="Limited to the last 7 days."
          >
            (Count: {metric.count})
          </Tooltip>
        </div>
        <div className="font-italic">Last seen {ago(metric.lastTrackedAt)}</div>
      </div>

      <div className="d-flex flex-column">
        <div
          className={clsx(
            !metric.createBinomialFromEvent ? "text-muted" : "",
            "border rounded px-2 mb-2 bg-light"
          )}
        >
          <div className="d-flex justify-content-between align-items-center">
            <div className="border-right p-1 pr-3">
              <Toggle
                value={metric.createBinomialFromEvent}
                id={`${metric}-${i}-binomial`}
                setValue={(value) => {
                  const newMetricsToCreate = cloneDeep(metricsToCreate);
                  newMetricsToCreate[i].createBinomialFromEvent = value;
                  setMetricsToCreate(newMetricsToCreate);
                }}
              />
            </div>
            <div className="p-1 d-flex justify-content-between align-items-center w-100 px-5">
              <h4 className="m-0">Metric Name: {metric.displayName} </h4>
              <h4 className="m-0">
                Type:{" "}
                <code
                  className={clsx(
                    !metric.createBinomialFromEvent && "text-muted"
                  )}
                >
                  binomial
                </code>
              </h4>
            </div>
            <div className="border-left p-1 pl-3">
              <Button
                color="link"
                disabled={!metric.createBinomialFromEvent}
                onClick={async () =>
                  setShowBinomialSqlPreview(!showBinomialSqlPreview)
                }
              >
                {showCountSqlPreview ? "Hide SQL" : "Preview SQL"}
              </Button>
            </div>
          </div>
          <div>
            {showBinomialSqlPreview && (
              <SQLInputField
                showPreview
                showHeader={false}
                showTestButton={false}
                userEnteredQuery={metric.binomialSqlQuery}
                datasourceId={dataSourceId || ""}
                requiredColumns={new Set()}
                queryType="metric"
                form={form}
              />
            )}
          </div>
        </div>
        <div
          className={clsx(
            !metric.createCountFromEvent ? "text-muted" : "",
            "border rounded px-2 mb-2 bg-light"
          )}
        >
          <div className="d-flex justify-content-between align-items-center">
            <div className="border-right p-1 pr-3">
              <Toggle
                value={metric.createCountFromEvent}
                id={`${metric}-${i}-count`}
                setValue={(value) => {
                  const newMetricsToCreate = cloneDeep(metricsToCreate);
                  newMetricsToCreate[i].createCountFromEvent = value;
                  setMetricsToCreate(newMetricsToCreate);
                }}
              />
            </div>
            <div className="p-1 d-flex justify-content-between align-items-center w-100 px-5">
              <h4 className="m-0">Metric Name: {metric.countDisplayName} </h4>
              <h4 className="m-0">
                Type:{" "}
                <code
                  className={clsx(!metric.createCountFromEvent && "text-muted")}
                >
                  count
                </code>
              </h4>
            </div>
            <div className="border-left p-1 pl-3">
              <Button
                color="link"
                disabled={!metric.createCountFromEvent}
                onClick={async () =>
                  setShowCountSqlPreview(!showCountSqlPreview)
                }
              >
                {showCountSqlPreview ? "Hide SQL" : "Preview SQL"}
              </Button>
            </div>
          </div>
          <div>
            {showCountSqlPreview && (
              <SQLInputField
                showPreview
                showHeader={false}
                showTestButton={false}
                userEnteredQuery={metric.countSqlQuery}
                datasourceId={dataSourceId || ""}
                requiredColumns={new Set()}
                queryType="metric"
                form={form}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
